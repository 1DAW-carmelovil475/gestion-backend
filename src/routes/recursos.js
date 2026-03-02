const express       = require('express');
const router        = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard } = require('../middleware/auth');

const STORAGE_BUCKET      = process.env.STORAGE_BUCKET      || 'ticket-archivos';
const CHAT_STORAGE_BUCKET = process.env.CHAT_STORAGE_BUCKET || 'chat-archivos';

// ── URL de archivo de ticket ──────────────────────────────────────────────────
router.get('/archivos/:archivoId/url', authGuard, async (req, res) => {
    const { data: archivo, error } = await supabaseAdmin
        .from('ticket_archivos')
        .select('storage_path, nombre_original, mime_type')
        .eq('id', req.params.archivoId)
        .single();

    if (error || !archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

    const { data: urlData, error: urlError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(archivo.storage_path, 3600);

    if (urlError) return res.status(500).json({ error: urlError.message });
    res.json({ url: urlData.signedUrl, nombre: archivo.nombre_original, mime_type: archivo.mime_type });
});

// ── Eliminar archivo de ticket ────────────────────────────────────────────────
router.delete('/archivos/:archivoId', authGuard, async (req, res) => {
    const { data: archivo } = await supabaseAdmin
        .from('ticket_archivos').select('*').eq('id', req.params.archivoId).single();
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

    if (archivo.subido_by !== req.user.id && req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Sin permisos para eliminar este archivo.' });
    }

    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([archivo.storage_path]);
    await supabaseAdmin.from('ticket_archivos').delete().eq('id', req.params.archivoId);
    res.json({ ok: true });
});

// ── Eliminar comentario ───────────────────────────────────────────────────────
router.delete('/comentarios/:comentarioId', authGuard, async (req, res) => {
    const { data: comentario } = await supabaseAdmin
        .from('ticket_comentarios').select('*').eq('id', req.params.comentarioId).single();
    if (!comentario) return res.status(404).json({ error: 'Comentario no encontrado.' });

    if (comentario.user_id !== req.user.id && req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Sin permisos para eliminar este comentario.' });
    }

    const { data: archivos } = await supabaseAdmin
        .from('ticket_comentarios_archivos').select('nombre_storage').eq('comentario_id', req.params.comentarioId);
    if (archivos?.length) {
        await supabaseAdmin.storage.from(STORAGE_BUCKET).remove(archivos.map(a => a.nombre_storage));
    }

    await supabaseAdmin.from('ticket_comentarios').delete().eq('id', req.params.comentarioId);
    res.json({ ok: true });
});

// ── URL de archivo de comentario ──────────────────────────────────────────────
router.get('/comentarios/archivos/:archivoId/url', authGuard, async (req, res) => {
    const { data: archivo, error } = await supabaseAdmin
        .from('ticket_comentarios_archivos')
        .select('nombre_storage, nombre_original, mime_type')
        .eq('id', req.params.archivoId)
        .single();

    if (error || !archivo) return res.status(404).json({ error: 'Archivo no encontrado.' });

    const { data: urlData, error: urlError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(archivo.nombre_storage, 3600);

    if (urlError) return res.status(500).json({ error: urlError.message });
    res.json({ url: urlData.signedUrl, nombre: archivo.nombre_original, mime_type: archivo.mime_type });
});

// ── Eliminar horas ────────────────────────────────────────────────────────────
router.delete('/horas/:horaId', authGuard, async (req, res) => {
    const { data: hora } = await supabaseAdmin
        .from('ticket_horas').select('user_id').eq('id', req.params.horaId).single();
    if (!hora) return res.status(404).json({ error: 'No encontrado' });
    if (hora.user_id !== req.user.id && req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Sin permisos.' });
    }
    await supabaseAdmin.from('ticket_horas').delete().eq('id', req.params.horaId);
    res.json({ ok: true });
});

// ── URL de archivo de chat ────────────────────────────────────────────────────
router.get('/chat/archivos/:archivoId/url', authGuard, async (req, res) => {
    const { data: archivo, error } = await supabaseAdmin
        .from('chat_mensajes_archivos')
        .select('nombre_storage, nombre_original, mime_type')
        .eq('id', req.params.archivoId)
        .single();

    if (error || !archivo) return res.status(404).json({ error: 'Archivo no encontrado.' });

    const { data: urlData, error: urlError } = await supabaseAdmin.storage
        .from(CHAT_STORAGE_BUCKET)
        .createSignedUrl(archivo.nombre_storage, 3600);

    if (urlError) return res.status(500).json({ error: urlError.message });
    res.json({ url: urlData.signedUrl, nombre: archivo.nombre_original, mime_type: archivo.mime_type });
});

module.exports = router;