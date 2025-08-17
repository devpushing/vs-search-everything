import * as path from 'path';
import * as fs from 'fs';

export function run(): Promise<void> {
    const testsRoot = path.resolve(__dirname);

    return new Promise((resolve, reject) => {
        try {
            // Find all test files
            const testFiles: string[] = [];
            
            function findTests(dir: string) {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        findTests(fullPath);
                    } else if (file.endsWith('.test.js')) {
                        testFiles.push(fullPath);
                    }
                }
            }
            
            findTests(testsRoot);
            
            if (testFiles.length === 0) {
                console.log('No test files found');
                return resolve();
            }

            console.log(`Found ${testFiles.length} test files`);
            
            // Since we're using mocha via npm script, just resolve
            resolve();
        } catch (err) {
            console.error('Error finding test files:', err);
            reject(err);
        }
    });
}

// Run tests if called directly
if (require.main === module) {
    run()
        .then(() => {
            console.log('Test discovery completed');
            process.exit(0);
        })
        .catch(err => {
            console.error('Test discovery failed:', err);
            process.exit(1);
        });
}