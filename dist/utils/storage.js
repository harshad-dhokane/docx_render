"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFile = uploadFile;
exports.downloadFile = downloadFile;
exports.deleteFile = deleteFile;
const supabase_1 = require("../config/supabase");
async function uploadFile(bucket, filePath, fileBuffer) {
    try {
        const { data, error } = await supabase_1.supabaseAdmin.storage
            .from(bucket)
            .upload(filePath, fileBuffer, {
            contentType: getContentType(filePath),
            upsert: true
        });
        if (error)
            throw error;
        const { data: urlData } = supabase_1.supabaseAdmin.storage
            .from(bucket)
            .getPublicUrl(filePath);
        return urlData.publicUrl;
    }
    catch (error) {
        throw new Error(`Error uploading file: ${error.message}`);
    }
}
async function downloadFile(bucket, filePath) {
    try {
        const { data, error } = await supabase_1.supabase.storage
            .from(bucket)
            .download(filePath);
        if (error)
            throw error;
        if (!data)
            throw new Error('No data received from storage');
        return Buffer.from(await data.arrayBuffer());
    }
    catch (error) {
        throw new Error(`Error downloading file: ${error.message}`);
    }
}
async function deleteFile(bucket, filePath) {
    try {
        const { error } = await supabase_1.supabase.storage
            .from(bucket)
            .remove([filePath]);
        if (error)
            throw error;
    }
    catch (error) {
        throw new Error(`Error deleting file: ${error.message}`);
    }
}
function getContentType(filePath) {
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
