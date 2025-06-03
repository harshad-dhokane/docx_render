"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadHandler = void 0;
const storage_1 = require("../utils/storage");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const BUCKET = process.env.SUPABASE_GENERATED_BUCKET || 'generated';
// MIME types for different file formats
const MIME_TYPES = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
// Output directories by file type
const OUTPUT_DIRS = {
    pdf: 'generatedPdf',
    excel: 'generatedExcel',
    docx: 'generatedDocx'
};
const downloadHandler = async (req, res) => {
    try {
        const { type, filename } = req.params;
        console.log('Download request:', { type, filename });
        // Additional validation
        if (!type || !filename) {
            console.error('Missing parameters:', { type, filename });
            res.status(400).send('Missing parameters');
            return;
        } // Get file from Supabase
        const fileBuffer = await (0, storage_1.downloadFile)(BUCKET, filename);
        // Set appropriate headers
        const encodedFilename = encodeURIComponent(filename);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
        res.setHeader('Content-Type', MIME_TYPES[type]);
        res.setHeader('Content-Length', fileBuffer.length);
        // Send the file
        res.send(fileBuffer);
    }
    catch (error) {
        console.error('Error downloading file:', error);
        if (!res.headersSent) {
            res.status(500).send(error.message);
        }
    }
};
exports.downloadHandler = downloadHandler;
