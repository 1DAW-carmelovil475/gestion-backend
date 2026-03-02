const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip', 'application/x-zip-compressed',
            'text/plain', 'text/csv',
            'video/mp4', 'video/quicktime',
            'audio/mpeg', 'audio/wav',
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
        }
    }
});

function restoreFileNames(files, req) {
    let fileNames = null;
    try {
        if (req.body.file_names) fileNames = JSON.parse(req.body.file_names);
    } catch {}
    if (!fileNames || !Array.isArray(fileNames)) return files;
    return files.map((file, i) => {
        if (fileNames[i]) file.originalname = fileNames[i];
        return file;
    });
}

module.exports = { upload, restoreFileNames };