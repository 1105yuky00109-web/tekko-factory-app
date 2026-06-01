const fs = require('fs');
const path = require('path');
const https = require('https');

// firebase-tools.json を読み込む
const userProfile = process.env.USERPROFILE || 'C:\\Users\\areva';
const appData = process.env.APPDATA || path.join(userProfile, 'AppData\\Roaming');

const paths = [
    path.join(userProfile, '.config', 'configstore', 'firebase-tools.json'),
    path.join(appData, 'configstore', 'firebase-tools.json')
];

let config = null;
for (const p of paths) {
    if (fs.existsSync(p)) {
        try {
            config = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (config.tokens && config.tokens.access_token) {
                break;
            }
        } catch (e) {
            console.error(`Error reading config at ${p}:`, e);
        }
    }
}

const accessToken = config.tokens.access_token;

function getCompanies(accessToken) {
    return new Promise((resolve, reject) => {
        const projectId = 'weekly-report-93e5f';
        const options = {
            hostname: 'firestore.googleapis.com',
            path: `/v1/projects/${projectId}/databases/(default)/documents/companies`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function simplifyValue(val) {
    if (!val) return val;
    if (val.stringValue !== undefined) return val.stringValue;
    if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
    if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
    if (val.booleanValue !== undefined) return val.booleanValue;
    if (val.timestampValue !== undefined) return val.timestampValue;
    if (val.arrayValue !== undefined) {
        const list = val.arrayValue.values || [];
        return list.map(simplifyValue);
    }
    if (val.mapValue !== undefined) {
        const fields = val.mapValue.fields || {};
        const obj = {};
        for (const [k, v] of Object.entries(fields)) {
            obj[k] = simplifyValue(v);
        }
        return obj;
    }
    return val;
}

async function main() {
    try {
        const result = await getCompanies(accessToken);
        if (result.documents) {
            console.log(`Found ${result.documents.length} companies:\n`);
            result.documents.forEach(doc => {
                const fields = doc.fields || {};
                const documentId = doc.name.split('/').pop();
                
                const decoded = {};
                for (const [key, value] of Object.entries(fields)) {
                    decoded[key] = simplifyValue(value);
                }
                
                console.log(`Company ID: ${documentId}`);
                console.log(JSON.stringify(decoded, null, 2));
                console.log("-----------------------------------------");
            });
        } else {
            console.log("No companies found.", JSON.stringify(result));
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

main();
