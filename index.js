//
// Node.js server to serve files from Backblaze B2
// With support for merging multiple PDF versions
//
import express from 'express';
import { PDFDocument } from 'pdf-lib';

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Authenticate with B2 Native API and get authorization token
async function b2Authorize() {
    const keyId = process.env.B2_APPLICATION_KEY_ID;
    const key = process.env.B2_APPLICATION_KEY;

    if (!keyId || !key) {
        throw new Error('B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY environment variables are required');
    }

    const authString = Buffer.from(`${keyId}:${key}`).toString('base64');
    const response = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
        method: 'GET',
        headers: {
            'Authorization': `Basic ${authString}`
        }
    });

    if (!response.ok) {
        throw new Error(`B2 authorization failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Extract the URLs from the nested structure
    return {
        authorizationToken: data.authorizationToken,
        apiUrl: data.apiInfo.storageApi.apiUrl,
        downloadUrl: data.apiInfo.storageApi.downloadUrl,
        accountId: data.accountId
    };
}

// List all versions of a specific file using B2 Native API
async function listFileVersions(authData, bucketId, fileName) {
    const versions = [];
    let startFileName = fileName;
    let startFileId = null;

    while (true) {
        const params = new URLSearchParams({
            bucketId: bucketId,
            startFileName: startFileName,
            maxFileCount: '10000',
            prefix: fileName
        });

        if (startFileId) {
            params.append('startFileId', startFileId);
        }

        const response = await fetch(`${authData.apiUrl}/b2api/v4/b2_list_file_versions?${params}`, {
            method: 'GET',
            headers: {
                'Authorization': authData.authorizationToken
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to list file versions: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Filter to only include versions that match the exact fileName and are uploads
        const matchingFiles = data.files.filter(f => f.fileName === fileName && f.action === 'upload');
        versions.push(...matchingFiles);

        // Check if there are more results
        if (data.nextFileName && data.nextFileName === fileName) {
            startFileName = data.nextFileName;
            startFileId = data.nextFileId;
        } else {
            break;
        }
    }

    return versions;
}

// Delete a file version using B2 Native API
async function deleteFileVersion(authData, fileId, fileName) {
    const response = await fetch(`${authData.apiUrl}/b2api/v4/b2_delete_file_version`, {
        method: 'POST',
        headers: {
            'Authorization': authData.authorizationToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fileId: fileId,
            fileName: fileName
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to delete file version ${fileId}: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

// Download a file using the download URL
async function downloadFile(authData, fileId) {
    const response = await fetch(`${authData.downloadUrl}/b2api/v4/b2_download_file_by_id?fileId=${fileId}`, {
        method: 'GET',
        headers: {
            'Authorization': authData.authorizationToken
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to download file ${fileId}: ${response.status} ${response.statusText}`);
    }

    return await response.arrayBuffer();
}

// Remove null bytes from PDF buffer using regex
function cleanPdfBuffer(buffer) {
    // Convert buffer to string (latin1 to preserve binary data)
    let str = Buffer.from(buffer).toString('latin1');
    // Remove null bytes with regex (similar to SQL regexp_replace)
    str = str.replace(/\u0000/g, '');
    // Convert back to buffer
    return Buffer.from(str, 'latin1');
}

// Combine multiple PDFs into one
async function combinePDFs(pdfBuffers) {
    const mergedPdf = await PDFDocument.create();

    for (const buffer of pdfBuffers) {
        try {
            const pdf = await PDFDocument.load(buffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => {
                mergedPdf.addPage(page);
            });
        } catch (error) {
            console.error('Error loading PDF:', error);
            throw error;
        }
    }

    return await mergedPdf.save();
}

// Get unique file versions by SHA1 hash and delete duplicates
async function deduplicateAndCombineVersions(authData, bucketId, fileName, mergeEnabled) {
    // Get all versions of the file
    const versions = await listFileVersions(authData, bucketId, fileName);

    console.log(`Found ${versions.length} version(s) of ${fileName}`);

    if (versions.length === 0) {
        return null;
    }

    // If only one version, just download and return it
    if (versions.length === 1) {
        console.log(`Only one version found, downloading: ${versions[0].fileId}`);
        const fileData = await downloadFile(authData, versions[0].fileId);
        return fileData;
    }

    // Group versions by SHA1 hash to identify duplicates
    const versionsByHash = new Map();

    for (const version of versions) {
        const hash = version.contentSha1;
        if (!versionsByHash.has(hash)) {
            versionsByHash.set(hash, []);
        }
        versionsByHash.get(hash).push(version);
    }

    console.log(`Found ${versionsByHash.size} unique version(s) by hash`);

    // Collect unique versions (keep the first of each hash group) and identify duplicates to delete
    const uniqueVersions = [];
    const versionsToDelete = [];

    for (const [hash, versionGroup] of versionsByHash.entries()) {
        // Keep the first version (usually the oldest)
        uniqueVersions.push(versionGroup[0]);

        // Mark the rest as duplicates to delete
        for (let i = 1; i < versionGroup.length; i++) {
            versionsToDelete.push(versionGroup[i]);
        }
    }

    // Delete duplicate versions
    for (const version of versionsToDelete) {
        try {
            await deleteFileVersion(authData, version.fileId, version.fileName);
            console.log(`Deleted duplicate version: ${version.fileId}`);
        } catch (error) {
            console.error(`Failed to delete version ${version.fileId}:`, error);
        }
    }

    // If only one unique version after deduplication, return it
    if (uniqueVersions.length === 1) {
        console.log(`One unique version after deduplication, downloading: ${uniqueVersions[0].fileId}`);
        const fileData = await downloadFile(authData, uniqueVersions[0].fileId);
        return fileData;
    }

    // If merge is not enabled, just return the latest version
    if (!mergeEnabled) {
        console.log(`Multiple versions but merge disabled, returning latest: ${uniqueVersions[0].fileId}`);
        const fileData = await downloadFile(authData, uniqueVersions[0].fileId);
        return fileData;
    }

    // Download all unique versions
    console.log(`Downloading ${uniqueVersions.length} unique versions for merging`);
    const pdfBuffers = [];
    for (const version of uniqueVersions) {
        const fileData = await downloadFile(authData, version.fileId);
        pdfBuffers.push(fileData);
    }

    // Combine all unique PDFs
    console.log(`Combining ${pdfBuffers.length} PDFs`);
    const combinedPdf = await combinePDFs(pdfBuffers);
    return combinedPdf;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Main file serving endpoint
app.get('/*', async (req, res) => {
    try {
        // Get the file path from URL
        let fullPath = req.path.replace(/^\//, '').replace(/\/$/, '');

        if (!fullPath) {
            return res.status(200).send('Backblaze B2 Proxy');
        }

        // Authorize with B2 Native API
        const authData = await b2Authorize();

        // Parse bucket mapping from environment (JSON format)
        if (!process.env.B2_BUCKET_MAP) {
            throw new Error('B2_BUCKET_MAP environment variable is required');
        }

        let bucketId;
        let filePath;

        try {
            const bucketMap = JSON.parse(process.env.B2_BUCKET_MAP);

            // Extract the first path segment as the bucket prefix
            const pathSegments = fullPath.split('/');
            const bucketPrefix = pathSegments[0];

            // Look up the bucket ID for this prefix
            bucketId = bucketMap[bucketPrefix];

            if (!bucketId) {
                return res.status(404).send(`Bucket prefix '${bucketPrefix}' not found. Available prefixes: ${Object.keys(bucketMap).join(', ')}`);
            }

            // The file path is everything after the bucket prefix
            filePath = pathSegments.slice(1).join('/');

            if (!filePath) {
                return res.status(404).send('File path required after bucket prefix');
            }
        } catch (error) {
            throw new Error(`Invalid B2_BUCKET_MAP JSON: ${error.message}`);
        }

        // Check if this is a PDF and if merging is enabled
        const isPdf = filePath.toLowerCase().endsWith('.pdf');
        const mergeVersions = String(process.env.MERGE_PDF_VERSIONS) === 'true';

        // Handle HEAD requests
        if (req.method === 'HEAD') {
            const versions = await listFileVersions(authData, bucketId, filePath);

            if (versions.length === 0) {
                return res.status(404).send('Not Found');
            }

            const latestVersion = versions[0];
            return res.status(200)
                .set('Content-Type', latestVersion.contentType || 'application/octet-stream')
                .set('Content-Length', latestVersion.contentLength.toString())
                .send();
        }

        // GET request - download and possibly merge
        let fileData = await deduplicateAndCombineVersions(authData, bucketId, filePath, isPdf && mergeVersions);

        if (fileData === null) {
            return res.status(404).send('Not Found');
        }

        // Note: PDF cleaning disabled - null bytes are part of valid PDF structure
        // if (isPdf) {
        //     console.log('Cleaning null bytes from PDF');
        //     fileData = cleanPdfBuffer(fileData);
        // }

        // Determine content type
        let contentType = 'application/octet-stream';
        if (isPdf) {
            contentType = 'application/pdf';
        } else if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) {
            contentType = 'image/jpeg';
        } else if (filePath.toLowerCase().endsWith('.png')) {
            contentType = 'image/png';
        } else if (filePath.toLowerCase().endsWith('.txt')) {
            contentType = 'text/plain';
        }

        // Cache durations (in seconds)
        const browserCacheTtl = parseInt(process.env.BROWSER_CACHE_TTL || '14400', 10); // 4 hours default
        const cdnCacheTtl = parseInt(process.env.CDN_CACHE_TTL || '31536000', 10); // 1 year default

        // Send response with caching headers
        res.status(200)
            .set('Content-Type', contentType)
            .set('Content-Disposition', `inline; filename="${filePath.split('/').pop()}"`)
            .set('Cache-Control', `public, max-age=${browserCacheTtl}`)
            .set('CDN-Cache-Control', `public, max-age=${cdnCacheTtl}`)
            .send(Buffer.from(fileData));

    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).send(`Error: ${error.message}`);
    }
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`B2 Proxy server listening on ${HOST}:${PORT}`);
    console.log(`Health check available at http://${HOST}:${PORT}/health`);
});
