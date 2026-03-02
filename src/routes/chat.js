const express       = require('express');
const router        = express.Router();
const path          = require('path');
const multer        = require('multer');
const supabaseAdmin = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');
const { upload, restoreFileNames } = require('../helpers/multer');

const CHAT_STORAGE_BUCKET = process.env.CHAT_STORAGE_BUCKET || 'chat-archivos';

// ── CANALES ───────────────────────────────────────────────────────────────────
router.get('/canales', authGuard, async (req, res) => {
    const { data: memberships, error: memberError } = await supabaseAdmin
        .from('chat_canales_miembros').select('canal_id').eq('user_id', req.user.id);

    if (memberError) return res.status(500).json({ error: memberError.message });

    const canalIds = memberships.map(m => m.canal_id);
    if (!canalIds.length) return res.json([]);

    const { data: canales, error } = await supabaseAdmin
        .from('chat_canales')
        .select(`id, nombre, descripcion, tipo, created_at, chat_canales_miembros(user_id, rol, joined_at)`)
        .in('id', canalIds)
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const userIds = new Set();
    canales.forEach(c => c.chat_canales_miembros?.forEach(m => userIds.add(m.user_id)));

    let profileMap = {};
    if (userIds.size) {
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', [...userIds]);
        perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });
    }

    res.json(canales.map(c => ({
        ...c,
        chat_canales_miembros: (c.chat_canales_miembros || []).map(m => ({
            ...m,
            profiles: { id: m.user_id, nombre: profileMap[m.user_id] || '?' },
        })),
    })));
});

router.post('/canales', authGuard, async (req, res) => {
    const { nombre, descripcion, tipo, miembros } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const { data: canal, error } = await supabaseAdmin
        .from('chat_canales')
        .insert({ nombre: nombre.toLowerCase().replace(/\s+/g, '-'), descripcion: descripcion || null, tipo: tipo || 'canal', creado_por: req.user.id })
        .select().single();

    if (error) {
        if (error.message.includes('unique') || error.code === '23505') {
            return res.status(409).json({ error: 'Ya existe un canal con ese nombre.' });
        }
        return res.status(500).json({ error: error.message });
    }

    const miembrosInsert = [{ canal_id: canal.id, user_id: req.user.id, rol: 'admin' }];
    if (miembros?.length) {
        miembros.forEach(uid => {
            if (uid !== req.user.id) miembrosInsert.push({ canal_id: canal.id, user_id: uid, rol: 'miembro' });
        });
    }
    await supabaseAdmin.from('chat_canales_miembros').insert(miembrosInsert);

    const { data: canalCompleto } = await supabaseAdmin
        .from('chat_canales')
        .select(`id, nombre, descripcion, tipo, created_at, chat_canales_miembros(user_id, rol, joined_at)`)
        .eq('id', canal.id).single();

    res.status(201).json(canalCompleto);
});

router.put('/canales/:id', authGuard, adminGuard, async (req, res) => {
    const { nombre, descripcion, miembros } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const { error: canalError } = await supabaseAdmin
        .from('chat_canales')
        .update({ nombre: nombre.toLowerCase().replace(/\s+/g, '-'), descripcion: descripcion || null })
        .eq('id', req.params.id);

    if (canalError) return res.status(500).json({ error: canalError.message });

    if (Array.isArray(miembros)) {
        await supabaseAdmin.from('chat_canales_miembros').delete()
            .eq('canal_id', req.params.id).neq('user_id', req.user.id);

        if (miembros.length > 0) {
            const inserts = miembros.filter(uid => uid !== req.user.id)
                .map(uid => ({ canal_id: req.params.id, user_id: uid, rol: 'miembro' }));
            if (inserts.length > 0) {
                await supabaseAdmin.from('chat_canales_miembros')
                    .upsert(inserts, { onConflict: 'canal_id,user_id' });
            }
        }
    }

    const { data: canalCompleto, error: fetchError } = await supabaseAdmin
        .from('chat_canales')
        .select(`id, nombre, descripcion, tipo, created_at, chat_canales_miembros(user_id, rol, joined_at)`)
        .eq('id', req.params.id).single();

    if (fetchError) return res.status(500).json({ error: fetchError.message });

    const userIds = (canalCompleto.chat_canales_miembros || []).map(m => m.user_id);
    let profileMap = {};
    if (userIds.length) {
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', userIds);
        perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });
    }

    res.json({
        ...canalCompleto,
        chat_canales_miembros: (canalCompleto.chat_canales_miembros || []).map(m => ({
            ...m, profiles: { id: m.user_id, nombre: profileMap[m.user_id] || '?' },
        })),
    });
});

router.delete('/canales/:id', authGuard, adminGuard, async (req, res) => {
    const { data: mensajes } = await supabaseAdmin
        .from('chat_mensajes').select('id').eq('canal_id', req.params.id);

    if (mensajes?.length) {
        const mensajeIds = mensajes.map(m => m.id);
        const { data: archivos } = await supabaseAdmin
            .from('chat_mensajes_archivos').select('nombre_storage').in('mensaje_id', mensajeIds);
        if (archivos?.length) {
            await supabaseAdmin.storage.from(CHAT_STORAGE_BUCKET).remove(archivos.map(a => a.nombre_storage));
        }
    }

    const { error } = await supabaseAdmin.from('chat_canales').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

router.post('/canales/:id/miembros', authGuard, async (req, res) => {
    const { miembros } = req.body;
    if (!miembros?.length) return res.status(400).json({ error: 'Debes proporcionar al menos un miembro.' });

    const inserts = miembros.map(uid => ({ canal_id: req.params.id, user_id: uid, rol: 'miembro' }));
    const { error } = await supabaseAdmin.from('chat_canales_miembros')
        .upsert(inserts, { onConflict: 'canal_id,user_id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ── MENSAJES ──────────────────────────────────────────────────────────────────
router.get('/canales/:id/mensajes', authGuard, async (req, res) => {
    const { limit = 100, before } = req.query;

    const { data: membership } = await supabaseAdmin
        .from('chat_canales_miembros')
        .select('canal_id').eq('canal_id', req.params.id).eq('user_id', req.user.id).single();

    if (!membership) return res.status(403).json({ error: 'No eres miembro de este canal.' });

    let query = supabaseAdmin
        .from('chat_mensajes')
        .select(`id, contenido, ticket_ref_id, anclado, editado, created_at, user_id, chat_mensajes_archivos(id, nombre_original, mime_type, tamanio)`)
        .eq('canal_id', req.params.id)
        .order('created_at', { ascending: true })
        .limit(Number(limit));

    if (before) query = query.lt('created_at', before);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const userIds = [...new Set(data.map(m => m.user_id))];
    let profileMap = {};
    if (userIds.length) {
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', userIds);
        perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });
    }

    const ticketRefIds = [...new Set(data.map(m => m.ticket_ref_id).filter(Boolean))];
    let ticketMap = {};
    if (ticketRefIds.length) {
        const { data: tickets } = await supabaseAdmin
            .from('tickets_v2').select('id, numero, asunto, estado').in('id', ticketRefIds);
        tickets?.forEach(t => { ticketMap[t.id] = t; });
    }

    res.json(data.map(m => ({
        ...m,
        profiles: { id: m.user_id, nombre: profileMap[m.user_id] || '?' },
        tickets:  m.ticket_ref_id ? ticketMap[m.ticket_ref_id] || null : null,
    })));
});

router.post('/canales/:id/mensajes', authGuard, (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Archivo supera el límite de 50MB.' });
            return res.status(400).json({ error: err.message });
        }
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    const contenido     = req.body.contenido?.trim() || '';
    const ticket_ref_id = req.body.ticket_ref_id || null;
    const files         = restoreFileNames(req.files || [], req);

    if (!contenido && !files.length) {
        return res.status(400).json({ error: 'El mensaje debe tener contenido o archivos.' });
    }

    const { data: membership } = await supabaseAdmin
        .from('chat_canales_miembros')
        .select('canal_id').eq('canal_id', req.params.id).eq('user_id', req.user.id).single();

    if (!membership) return res.status(403).json({ error: 'No eres miembro de este canal.' });

    const { data: mensaje, error: mensajeError } = await supabaseAdmin
        .from('chat_mensajes')
        .insert({ canal_id: req.params.id, user_id: req.user.id, contenido: contenido || '', ticket_ref_id: ticket_ref_id || null, anclado: false, editado: false })
        .select('id, contenido, ticket_ref_id, anclado, editado, created_at, user_id')
        .single();

    if (mensajeError) return res.status(500).json({ error: mensajeError.message });

    const archivosGuardados = [];
    for (const file of files) {
        try {
            const ext         = path.extname(file.originalname).toLowerCase() || '.bin';
            const safeName    = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
            const storagePath = `chat/${req.params.id}/${mensaje.id}/${safeName}`;

            const { error: storageError } = await supabaseAdmin.storage
                .from(CHAT_STORAGE_BUCKET)
                .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

            if (storageError) { console.error('Storage error chat:', storageError.message); continue; }

            const { data: archivoData } = await supabaseAdmin
                .from('chat_mensajes_archivos')
                .insert({ mensaje_id: mensaje.id, nombre_original: file.originalname, nombre_storage: storagePath, mime_type: file.mimetype, tamanio: file.size })
                .select().single();

            if (archivoData) archivosGuardados.push(archivoData);
        } catch (err) {
            console.error('Error subiendo archivo chat:', err.message);
        }
    }

    let ticketRef = null;
    if (ticket_ref_id) {
        const { data: t } = await supabaseAdmin
            .from('tickets_v2').select('id, numero, asunto, estado').eq('id', ticket_ref_id).single();
        ticketRef = t || null;
    }

    res.status(201).json({
        ...mensaje,
        chat_mensajes_archivos: archivosGuardados,
        profiles: { id: req.user.id, nombre: req.user.nombre || req.user.email },
        tickets:  ticketRef,
    });
});

router.patch('/mensajes/:mensajeId', authGuard, async (req, res) => {
    const { contenido } = req.body;
    if (!contenido?.trim()) return res.status(400).json({ error: 'El contenido no puede estar vacío.' });

    const { data: mensaje } = await supabaseAdmin
        .from('chat_mensajes').select('user_id').eq('id', req.params.mensajeId).single();

    if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' });
    if (mensaje.user_id !== req.user.id) return res.status(403).json({ error: 'Solo puedes editar tus propios mensajes.' });

    const { data, error } = await supabaseAdmin
        .from('chat_mensajes')
        .update({ contenido: contenido.trim(), editado: true })
        .eq('id', req.params.mensajeId)
        .select('id, contenido, editado, anclado, created_at, user_id')
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.patch('/mensajes/:mensajeId/pin', authGuard, async (req, res) => {
    const { anclado } = req.body;
    if (typeof anclado !== 'boolean') return res.status(400).json({ error: 'El campo "anclado" debe ser booleano.' });

    const { data, error } = await supabaseAdmin
        .from('chat_mensajes').update({ anclado }).eq('id', req.params.mensajeId).select('id, anclado').single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/mensajes/:mensajeId', authGuard, async (req, res) => {
    const { data: mensaje } = await supabaseAdmin
        .from('chat_mensajes').select('*').eq('id', req.params.mensajeId).single();
    if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' });

    if (mensaje.user_id !== req.user.id && req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Sin permisos para eliminar este mensaje.' });
    }

    const { data: archivos } = await supabaseAdmin
        .from('chat_mensajes_archivos').select('nombre_storage').eq('mensaje_id', req.params.mensajeId);
    if (archivos?.length) {
        await supabaseAdmin.storage.from(CHAT_STORAGE_BUCKET).remove(archivos.map(a => a.nombre_storage));
    }

    await supabaseAdmin.from('chat_mensajes').delete().eq('id', req.params.mensajeId);
    res.json({ ok: true });
});

module.exports = router;