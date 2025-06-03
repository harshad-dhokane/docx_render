import { supabase, supabaseAdmin } from '../config/supabase';

export async function uploadFile(bucket: string, filePath: string, fileBuffer: Buffer): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        contentType: getContentType(filePath),
        upsert: true
      });

    if (error) throw error;
      const { data: urlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error: any) {
    throw new Error(`Error uploading file: ${error.message}`);
  }
}

export async function downloadFile(bucket: string, filePath: string): Promise<Buffer> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(filePath);

    if (error) throw error;
    if (!data) throw new Error('No data received from storage');

    return Buffer.from(await data.arrayBuffer());
  } catch (error: any) {
    throw new Error(`Error downloading file: ${error.message}`);
  }
}

export async function deleteFile(bucket: string, filePath: string): Promise<void> {
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([filePath]);

    if (error) throw error;
  } catch (error: any) {
    throw new Error(`Error deleting file: ${error.message}`);
  }
}

function getContentType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}
