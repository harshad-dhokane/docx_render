import { RequestHandler } from 'express';
import { downloadFile } from '../utils/storage';
import { supabase } from '../config/supabase';
import dotenv from 'dotenv';

dotenv.config();

const BUCKET = process.env.SUPABASE_GENERATED_BUCKET || 'generated';

// (Removed unused DIRS validation block as DIRS is not defined)

interface DownloadParams {
  type: 'pdf' | 'excel' | 'docx';
  filename: string;
}

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

export const downloadHandler: RequestHandler<DownloadParams> = async (req, res) => {
  try {
    const { type, filename } = req.params;
    console.log('Download request:', { type, filename });
    
    // Additional validation
    if (!type || !filename) {
      console.error('Missing parameters:', { type, filename });
      res.status(400).send('Missing parameters');
      return;
    }    // Get file from Supabase
    const fileBuffer = await downloadFile(BUCKET, filename);

    // Set appropriate headers
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Type', MIME_TYPES[type]);
    res.setHeader('Content-Length', fileBuffer.length);
    
    // Send the file
    res.send(fileBuffer);
    
  } catch (error: any) {
    console.error('Error downloading file:', error);
    if (!res.headersSent) {
      res.status(500).send(error.message);
    }
  }
};
