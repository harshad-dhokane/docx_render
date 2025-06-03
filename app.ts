import express, { Request, Response } from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { TemplateHandler, MimeType } from 'easy-template-x';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as ExcelJS from 'exceljs';
import { downloadHandler } from './routes/download';
import { uploadFile, downloadFile, deleteFile } from './utils/storage';
import { supabase, supabaseAdmin } from './config/supabase';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);
const app = express();
const port = process.env.PORT || 3000;

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
      const { data, error } = await supabaseAdmin.storage.getBucket(bucket);
      
      if (error) {
        if (error.message.includes('not found')) {
          console.log(`Creating bucket: ${bucket}`);
          const { error: createError } = await supabaseAdmin.storage.createBucket(bucket, {
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
        } else {
          throw new Error(`Error checking bucket ${bucket}: ${error.message}`);
        }
      } else {
        console.log(`✅ Verified bucket: ${bucket}`);
      }
    } catch (error: any) {
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
  } catch (error) {
    console.error('Server failed to start due to storage initialization error');
    process.exit(1);
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Set up views directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configure multer to use memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Function to create a temporary directory
async function createTempDir(): Promise<string> {
  const tempDir = path.join(os.tmpdir(), 'docx-template-' + Date.now());
  await fs.promises.mkdir(tempDir, { recursive: true });
  return tempDir;
}

// Function to find placeholders in Excel workbook
async function findExcelPlaceholders(workbook: ExcelJS.Workbook): Promise<Set<string>> {
  const placeholders = new Set<string>();
  const placeholderRegex = /{{([^}]+)}}/g;

  workbook.worksheets.forEach(worksheet => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        let cellValue = '';
        const rawValue = cell.value;
        
        if (typeof rawValue === 'string') {
          cellValue = rawValue;
        } else if (rawValue && typeof rawValue === 'object' && 'result' in rawValue) {
          cellValue = rawValue.result?.toString() || '';
        } else if (rawValue && typeof rawValue === 'object' && 'text' in rawValue) {
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
async function processExcelTemplate(workbook: ExcelJS.Workbook, formData: any): Promise<Buffer> {
  const placeholderRegex = /{{([^}]+)}}/g;

  workbook.worksheets.forEach(worksheet => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === 'string') {
          const cellValue = cell.value;
          if (cellValue.match(placeholderRegex)) {
            cell.value = cellValue.replace(placeholderRegex, (match, placeholder) => {
              const value = formData[placeholder];
              if (value === undefined) return match;
              
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
  const arrayBuffer = await workbook.xlsx.writeBuffer() as ArrayBuffer;
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

    const fileExt = path.extname(req.file.originalname).toLowerCase();
    if (!['.xlsx', '.docx'].includes(fileExt)) {
      throw new Error('Unsupported file format. Please upload a .docx or .xlsx file.');
    }

    // Upload to Supabase storage
    const filePath = req.file.originalname;
    await uploadFile(BUCKETS.templates, filePath, req.file.buffer);

    let uniquePlaceholders: Set<string>;
      if (fileExt === '.xlsx') {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        uniquePlaceholders = await findExcelPlaceholders(workbook);
      } catch (error: any) {
        throw new Error(`Failed to process Excel template: ${error.message}`);
      }
    } else {
      const handler = new TemplateHandler();
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

  } catch (error: any) {
    console.error('Error processing template:', error);
    res.status(500).send(error.message);
  }
});

// Generate document from form data
app.post('/generate', async (req, res) => {
  const tempDir = await createTempDir();
  try {
    const { templateName, formData } = req.body;
    const fileExt = path.extname(templateName).toLowerCase();
    const timestamp = new Date().getTime();

    // Download template from Supabase
    const templateBuffer = await downloadFile(BUCKETS.templates, templateName);
    const tempTemplatePath = path.join(tempDir, templateName);
    await fs.promises.writeFile(tempTemplatePath, templateBuffer);

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
        const tempExcelPath = path.join(tempDir, excelFilename);
        await fs.promises.writeFile(tempExcelPath, processedBuffer);
        
        // Convert to PDF
        const tempPdfPath = path.join(tempDir, pdfFilename);
        await convertToPdf(tempExcelPath, tempPdfPath);
        
        // Upload both files to Supabase
        await uploadFile(BUCKETS.generated, excelFilename, processedBuffer);
        const pdfBuffer = await fs.promises.readFile(tempPdfPath);
        await uploadFile(BUCKETS.generated, pdfFilename, pdfBuffer);
        
        res.json({
          message: 'Files generated successfully',
          excelFilename,
          pdfFilename,
          fileType: 'excel'
        });
      } catch (error: any) {
        throw new Error(`Failed to process Excel file: ${error.message}`);
      }
    } else if (fileExt === '.docx') {
      // Process image data
      Object.entries(formData).forEach(([key, value]: [string, any]) => {
        if (value && value._type === 'image') {
          formData[key] = {
            _type: 'image',
            source: Buffer.from(value.source, 'base64'),
            format: MimeType.Png,
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
      const handler = new TemplateHandler();
      const processedBuffer = await handler.process(templateBuffer, formData);
      
      // Save DOCX to temp directory for PDF conversion
      const tempDocxPath = path.join(tempDir, docxFilename);
      await fs.promises.writeFile(tempDocxPath, processedBuffer);
      
      // Convert to PDF
      const tempPdfPath = path.join(tempDir, pdfFilename);
      await convertToPdf(tempDocxPath, tempPdfPath);
      
      // Upload both files to Supabase
      await uploadFile(BUCKETS.generated, docxFilename, processedBuffer);
      const pdfBuffer = await fs.promises.readFile(tempPdfPath);
      await uploadFile(BUCKETS.generated, pdfFilename, pdfBuffer);

      res.json({
        message: 'Files generated successfully',
        docxFilename,
        pdfFilename,
        fileType: 'docx'
      });
    }

  } catch (error: any) {
    console.error('Error generating document:', error);
    res.status(500).send(error.message);
  } finally {
    // Cleanup temp directory
    try {
      await fs.promises.rm(tempDir, { recursive: true });
    } catch (error) {
      console.error('Error cleaning up temp directory:', error);
    }
  }
});

// Function to convert files to PDF using LibreOffice
async function convertToPdf(inputPath: string, outputPath: string): Promise<void> {
  const absoluteInputPath = path.resolve(inputPath);
  const absoluteOutputDir = path.resolve(path.dirname(outputPath));
  
  const command = `soffice --headless --convert-to pdf --outdir "${absoluteOutputDir}" "${absoluteInputPath}"`;
  await execAsync(command);
  
  const expectedPdfPath = path.join(
    absoluteOutputDir,
    path.basename(absoluteInputPath, path.extname(absoluteInputPath)) + '.pdf'
  );
  
  if (!fs.existsSync(expectedPdfPath)) {
    throw new Error('PDF file was not created after conversion');
  }
}

// Updated download handler that uses Supabase
app.get('/download/:type/:filename', async (req, res) => {
  try {
    const { type, filename } = req.params;
    console.log('Download request:', { type, filename });

    // Get file from Supabase
    const fileBuffer = await downloadFile(BUCKETS.generated, filename);

    // Set appropriate headers
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };

    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Type', mimeTypes[type]);
    res.setHeader('Content-Length', fileBuffer.length);
    
    res.send(fileBuffer);

  } catch (error: any) {
    console.error('Error downloading file:', error);
    res.status(500).send(error.message);
  }
});

// Cleanup old files from Supabase (run every 12 hours)
async function cleanupGeneratedFiles(maxAgeHours: number = 1): Promise<void> {
  try {
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    const { data: files, error } = await supabase.storage
      .from(BUCKETS.generated)
      .list();

    if (error) throw error;

    for (const file of files) {
      if (now - new Date(file.created_at).getTime() > maxAge) {
        await deleteFile(BUCKETS.generated, file.name);
        console.log(`Cleaned up old file: ${file.name}`);
      }
    }
  } catch (error) {
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
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
