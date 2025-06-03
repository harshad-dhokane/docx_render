"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const easy_template_x_1 = require("easy-template-x");
const child_process_1 = require("child_process");
const util_1 = require("util");
const ExcelJS = __importStar(require("exceljs"));
const storage_1 = require("./utils/storage");
const supabase_1 = require("./config/supabase");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const app = (0, express_1.default)();
const port = 3000;
// Supabase storage buckets
const BUCKETS = {
    templates: process.env.SUPABASE_TEMPLATES_BUCKET || 'templates',
    generated: process.env.SUPABASE_GENERATED_BUCKET || 'generated'
};
// Function to verify and create Supabase buckets if needed
async function verifyBuckets() {
    for (const [name, bucket] of Object.entries(BUCKETS)) {
        try {
            console.log(`Checking bucket: ${bucket}`);
            const { data, error } = await supabase_1.supabaseAdmin.storage.getBucket(bucket);
            if (error) {
                if (error.message.includes('not found')) {
                    console.log(`Creating bucket: ${bucket}`);
                    const { error: createError } = await supabase_1.supabaseAdmin.storage.createBucket(bucket, {
                        public: true,
                        fileSizeLimit: 52428800 // 50MB limit
                    });
                    if (createError) {
                        if (createError.message.includes('already exists')) {
                            console.log(`✅ Bucket ${bucket} already exists`);
                            continue;
                        }
                        throw new Error(`Failed to create bucket ${bucket}: ${createError.message}`);
                    }
                    console.log(`✅ Created bucket: ${bucket}`);
                }
                else {
                    throw new Error(`Error checking bucket ${bucket}: ${error.message}`);
                }
            }
            else {
                console.log(`✅ Verified bucket: ${bucket}`);
            }
        }
        catch (error) {
            // Check if the error is due to the bucket already existing
            if (error.message && error.message.includes('already exists')) {
                console.log(`✅ Bucket ${bucket} already exists`);
                continue;
            }
            console.error(`❌ Error with bucket ${bucket}:`, error);
            throw error;
        }
    }
    console.log('✅ All buckets verified successfully');
}
// Initialize Supabase buckets before starting the server
app.listen(port, async () => {
    try {
        await verifyBuckets();
        console.log(`Server running at http://localhost:${port}`);
    }
    catch (error) {
        console.error('Server failed to start due to storage initialization error');
        process.exit(1);
    }
});
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
// Set up views directory
app.set('view engine', 'ejs');
app.set('views', path_1.default.join(__dirname, 'views'));
// Configure multer to use memory storage
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// Function to create a temporary directory
async function createTempDir() {
    const tempDir = path_1.default.join(os_1.default.tmpdir(), 'docx-template-' + Date.now());
    await fs_1.default.promises.mkdir(tempDir, { recursive: true });
    return tempDir;
}
// Function to find placeholders in Excel workbook
async function findExcelPlaceholders(workbook) {
    const placeholders = new Set();
    const placeholderRegex = /{{([^}]+)}}/g;
    workbook.worksheets.forEach(worksheet => {
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                var _a;
                let cellValue = '';
                const rawValue = cell.value;
                if (typeof rawValue === 'string') {
                    cellValue = rawValue;
                }
                else if (rawValue && typeof rawValue === 'object' && 'result' in rawValue) {
                    cellValue = ((_a = rawValue.result) === null || _a === void 0 ? void 0 : _a.toString()) || '';
                }
                else if (rawValue && typeof rawValue === 'object' && 'text' in rawValue) {
                    cellValue = rawValue.text || '';
                }
                if (cellValue) {
                    const matches = cellValue.match(placeholderRegex);
                    if (matches) {
                        matches.forEach(match => {
                            placeholders.add(match.slice(2, -2));
                        });
                    }
                }
            });
        });
    });
    return placeholders;
}
// Function to process Excel template with form data
async function processExcelTemplate(workbook, formData) {
    const placeholderRegex = /{{([^}]+)}}/g;
    workbook.worksheets.forEach(worksheet => {
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                if (typeof cell.value === 'string') {
                    const cellValue = cell.value;
                    if (cellValue.match(placeholderRegex)) {
                        cell.value = cellValue.replace(placeholderRegex, (match, placeholder) => {
                            const value = formData[placeholder];
                            if (value === undefined)
                                return match;
                            if (typeof value === 'string') {
                                if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
                                    return new Date(value);
                                }
                                if (!isNaN(Number(value)) && value.trim() !== '') {
                                    return Number(value);
                                }
                            }
                            return value;
                        });
                    }
                }
            });
        });
    });
    // Write workbook to buffer and ensure it's a proper Buffer
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    return Buffer.from(uint8Array);
}
// Routes
app.get('/', (req, res) => {
    res.render('index');
});
// Upload template and extract placeholders
app.post('/upload', upload.single('template'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('No file uploaded');
        }
        const fileExt = path_1.default.extname(req.file.originalname).toLowerCase();
        if (!['.xlsx', '.docx'].includes(fileExt)) {
            throw new Error('Unsupported file format. Please upload a .docx or .xlsx file.');
        }
        // Upload to Supabase storage
        const filePath = req.file.originalname;
        await (0, storage_1.uploadFile)(BUCKETS.templates, filePath, req.file.buffer);
        let uniquePlaceholders;
        if (fileExt === '.xlsx') {
            try {
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(req.file.buffer);
                uniquePlaceholders = await findExcelPlaceholders(workbook);
            }
            catch (error) {
                throw new Error(`Failed to process Excel template: ${error.message}`);
            }
        }
        else {
            const handler = new easy_template_x_1.TemplateHandler();
            const tags = await handler.parseTags(req.file.buffer);
            uniquePlaceholders = new Set(tags.map(tag => tag.name));
        }
        if (uniquePlaceholders.size === 0) {
            throw new Error('No placeholders found in template');
        }
        return res.render('form', {
            placeholders: Array.from(uniquePlaceholders),
            templateName: req.file.originalname
        });
    }
    catch (error) {
        console.error('Error processing template:', error);
        res.status(500).send(error.message);
    }
});
// Generate document from form data
app.post('/generate', async (req, res) => {
    const tempDir = await createTempDir();
    try {
        const { templateName, formData } = req.body;
        const fileExt = path_1.default.extname(templateName).toLowerCase();
        const timestamp = new Date().getTime();
        // Download template from Supabase
        const templateBuffer = await (0, storage_1.downloadFile)(BUCKETS.templates, templateName);
        const tempTemplatePath = path_1.default.join(tempDir, templateName);
        await fs_1.default.promises.writeFile(tempTemplatePath, templateBuffer);
        if (fileExt === '.xlsx') {
            try {
                // Load Excel workbook from temp file
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.readFile(tempTemplatePath);
                // Process template and get buffer
                const processedBuffer = await processExcelTemplate(workbook, formData);
                // Save processed Excel
                const excelFilename = `generated-${timestamp}.xlsx`;
                const pdfFilename = `generated-${timestamp}.pdf`;
                // Save Excel to temp directory for PDF conversion
                const tempExcelPath = path_1.default.join(tempDir, excelFilename);
                await fs_1.default.promises.writeFile(tempExcelPath, processedBuffer);
                // Convert to PDF
                const tempPdfPath = path_1.default.join(tempDir, pdfFilename);
                await convertToPdf(tempExcelPath, tempPdfPath);
                // Upload both files to Supabase
                await (0, storage_1.uploadFile)(BUCKETS.generated, excelFilename, processedBuffer);
                const pdfBuffer = await fs_1.default.promises.readFile(tempPdfPath);
                await (0, storage_1.uploadFile)(BUCKETS.generated, pdfFilename, pdfBuffer);
                res.json({
                    message: 'Files generated successfully',
                    excelFilename,
                    pdfFilename,
                    fileType: 'excel'
                });
            }
            catch (error) {
                throw new Error(`Failed to process Excel file: ${error.message}`);
            }
        }
        else if (fileExt === '.docx') {
            // Process image data
            Object.entries(formData).forEach(([key, value]) => {
                if (value && value._type === 'image') {
                    formData[key] = {
                        _type: 'image',
                        source: Buffer.from(value.source, 'base64'),
                        format: easy_template_x_1.MimeType.Png,
                        width: 150,
                        height: 100,
                        altText: value.altText || key,
                        transparencyPercent: value.transparencyPercent || 0
                    };
                }
            });
            const docxFilename = `generated-${timestamp}.docx`;
            const pdfFilename = `generated-${timestamp}.pdf`;
            // Process template
            const handler = new easy_template_x_1.TemplateHandler();
            const processedBuffer = await handler.process(templateBuffer, formData);
            // Save DOCX to temp directory for PDF conversion
            const tempDocxPath = path_1.default.join(tempDir, docxFilename);
            await fs_1.default.promises.writeFile(tempDocxPath, processedBuffer);
            // Convert to PDF
            const tempPdfPath = path_1.default.join(tempDir, pdfFilename);
            await convertToPdf(tempDocxPath, tempPdfPath);
            // Upload both files to Supabase
            await (0, storage_1.uploadFile)(BUCKETS.generated, docxFilename, processedBuffer);
            const pdfBuffer = await fs_1.default.promises.readFile(tempPdfPath);
            await (0, storage_1.uploadFile)(BUCKETS.generated, pdfFilename, pdfBuffer);
            res.json({
                message: 'Files generated successfully',
                docxFilename,
                pdfFilename,
                fileType: 'docx'
            });
        }
    }
    catch (error) {
        console.error('Error generating document:', error);
        res.status(500).send(error.message);
    }
    finally {
        // Cleanup temp directory
        try {
            await fs_1.default.promises.rm(tempDir, { recursive: true });
        }
        catch (error) {
            console.error('Error cleaning up temp directory:', error);
        }
    }
});
// Function to convert files to PDF using LibreOffice
async function convertToPdf(inputPath, outputPath) {
    const absoluteInputPath = path_1.default.resolve(inputPath);
    const absoluteOutputDir = path_1.default.resolve(path_1.default.dirname(outputPath));
    const command = `soffice --headless --convert-to pdf --outdir "${absoluteOutputDir}" "${absoluteInputPath}"`;
    await execAsync(command);
    const expectedPdfPath = path_1.default.join(absoluteOutputDir, path_1.default.basename(absoluteInputPath, path_1.default.extname(absoluteInputPath)) + '.pdf');
    if (!fs_1.default.existsSync(expectedPdfPath)) {
        throw new Error('PDF file was not created after conversion');
    }
}
// Updated download handler that uses Supabase
app.get('/download/:type/:filename', async (req, res) => {
    try {
        const { type, filename } = req.params;
        console.log('Download request:', { type, filename });
        // Get file from Supabase
        const fileBuffer = await (0, storage_1.downloadFile)(BUCKETS.generated, filename);
        // Set appropriate headers
        const mimeTypes = {
            pdf: 'application/pdf',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };
        const encodedFilename = encodeURIComponent(filename);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
        res.setHeader('Content-Type', mimeTypes[type]);
        res.setHeader('Content-Length', fileBuffer.length);
        res.send(fileBuffer);
    }
    catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).send(error.message);
    }
});
// Cleanup old files from Supabase (run every 12 hours)
async function cleanupGeneratedFiles(maxAgeHours = 1) {
    try {
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000;
        const { data: files, error } = await supabase_1.supabase.storage
            .from(BUCKETS.generated)
            .list();
        if (error)
            throw error;
        for (const file of files) {
            if (now - new Date(file.created_at).getTime() > maxAge) {
                await (0, storage_1.deleteFile)(BUCKETS.generated, file.name);
                console.log(`Cleaned up old file: ${file.name}`);
            }
        }
    }
    catch (error) {
        console.error('Error cleaning up files:', error);
    }
}
// Run cleanup on server start and every 12 hours
cleanupGeneratedFiles();
setInterval(() => cleanupGeneratedFiles(), 12 * 60 * 60 * 1000);
// Start server with bucket verification
const startServer = async () => {
    try {
        await verifyBuckets();
        app.listen(port, () => {
            console.log(`✅ Server running at http://localhost:${port}`);
        });
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
