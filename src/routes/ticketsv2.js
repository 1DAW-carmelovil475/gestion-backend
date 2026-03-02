const express       = require('express');
const router        = express.Router();
const path          = require('path');
const multer        = require('multer');
const supabaseAdmin = require('../supabase');
const { authGuard, adminGuard }                          = require('../middleware/auth');
const { registrarHistorial, calcularHorasTranscurridas } = require('../helpers/historial');
const { getPerfilesConEmail, enviarEmailAsignacion }      = require('../helpers/email');
const { upload, restoreFileNames }                        = require('../helpers/multer');

const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'ticket-archivos';

// ── LISTADO ──────────────────────────────────────────────────────────────────
router.get('/', authGuard, async (req, res) => {
    const { estado, prioridad, empresa_id, operario_id, search, desde, hasta } = req.query;

    let query = supabaseAdmin
        .from('tickets_v2')
        .select(`
            id, numero, asunto, descripcion, prioridad, estado, notas,
            created_at, started_at, completed_at, invoiced_at,
            empresa_id, dispositivo_id,
            empresas(id, nombre),
            dispositivos(id, nombre, tipo),
            ticket_asignaciones(user_id, asignado_at)
        `)
        .order('created_at', { ascending: false });

    if (estado && estado !== 'all')       query = query.eq('estado', estado);
    if (prioridad && prioridad !== 'all') query = query.eq('prioridad', prioridad);
    if (empresa_id)                       query = query.eq('empresa_id', empresa_id);
    if (desde)                            query = query.gte('created_at', desde);
    if (hasta)                            query = query.lte('created_at', hasta + 'T23:59:59');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const userIds = new Set();
    data.forEach(t => t.ticket_asignaciones?.forEach(a => userIds.add(a.user_id)));

    let profileMap = {};
    if (userIds.size > 0) {
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', [...userIds]);
        perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });
    }

    let result = data.map(t => ({
        ...t,
        ticket_asignaciones: (t.ticket_asignaciones || []).map(a => ({
            ...a,
            profiles: { id: a.user_id, nombre: profileMap[a.user_id] || '?' },
        })),
        horas_transcurridas: calcularHorasTranscurridas(t),
    }));

    if (operario_id) {
        result = result.filter(t => t.ticket_asignaciones?.some(a => a.user_id === operario_id));
    }
    if (search) {
        const s = search.toLowerCase();
        result = result.filter(t =>
            t.asunto?.toLowerCase().includes(s) ||
            t.empresas?.nombre?.toLowerCase().includes(s) ||
            String(t.numero).includes(s)
        );
    }

    res.json(result);
});

// ── DETALLE ──────────────────────────────────────────────────────────────────
router.get('/:id', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .select(`
            *,
            empresas(id, nombre, email, telefono, contactos),
            dispositivos(id, nombre, tipo, ip, numero_serie),
            ticket_asignaciones(id, user_id, asignado_at),
            ticket_historial(id, tipo, descripcion, datos, created_at, user_id),
            ticket_horas(id, horas, descripcion, fecha, user_id),
            ticket_archivos(id, nombre_original, storage_path, mime_type, tamanio, created_at, subido_by)
        `)
        .eq('id', req.params.id)
        .single();

    if (error) return res.status(404).json({ error: 'Ticket no encontrado' });

    const userIds = new Set();
    data.ticket_asignaciones?.forEach(a => userIds.add(a.user_id));
    data.ticket_historial?.forEach(h => { if (h.user_id) userIds.add(h.user_id); });
    data.ticket_horas?.forEach(h => userIds.add(h.user_id));
    data.ticket_archivos?.forEach(a => { if (a.subido_by) userIds.add(a.subido_by); });

    const { data: perfiles } = await supabaseAdmin
        .from('profiles').select('id, nombre').in('id', [...userIds]);
    const profileMap = {};
    perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });

    if (data.ticket_asignaciones) {
        data.ticket_asignaciones = data.ticket_asignaciones.map(a => ({
            ...a, profiles: { id: a.user_id, nombre: profileMap[a.user_id] || '?' }
        }));
    }
    if (data.ticket_historial) {
        data.ticket_historial = data.ticket_historial
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .map(h => ({ ...h, profiles: { nombre: profileMap[h.user_id] || 'Sistema' } }));
    }
    if (data.ticket_horas) {
        data.ticket_horas = data.ticket_horas.map(h => ({
            ...h, profiles: { id: h.user_id, nombre: profileMap[h.user_id] || '?' }
        }));
    }
    if (data.ticket_archivos) {
        data.ticket_archivos = data.ticket_archivos.map(a => ({
            ...a, profiles: { nombre: profileMap[a.subido_by] || '?' }
        }));
    }

    data.horas_transcurridas = calcularHorasTranscurridas(data);
    data.horas_totales = (data.ticket_horas || []).reduce((s, h) => s + Number(h.horas), 0);

    res.json(data);
});

// ── CREAR ────────────────────────────────────────────────────────────────────
router.post('/', authGuard, async (req, res) => {
    const { empresa_id, dispositivo_id, asunto, descripcion, prioridad, estado, operarios, notas } = req.body;
    if (!empresa_id || !asunto) {
        return res.status(400).json({ error: 'empresa_id y asunto son obligatorios.' });
    }

    const { data: ticket, error } = await supabaseAdmin
        .from('tickets_v2')
        .insert({
            empresa_id,
            dispositivo_id: dispositivo_id || null,
            asunto,
            descripcion: descripcion || null,
            notas: notas || null,
            prioridad: prioridad || 'Media',
            estado: estado || 'Pendiente',
            created_by: req.user.id,
        })
        .select().single();

    if (error) return res.status(500).json({ error: error.message });

    await registrarHistorial(
        ticket.id, req.user.id, 'creacion',
        `Ticket #${ticket.numero} creado por ${req.user.nombre || req.user.email}`
    );

    if (operarios?.length) {
        await supabaseAdmin.from('ticket_asignaciones').insert(
            operarios.map(uid => ({ ticket_id: ticket.id, user_id: uid, asignado_by: req.user.id }))
        );
        const perfiles = await getPerfilesConEmail(operarios);
        const nombres = perfiles?.map(p => p.nombre).join(', ') || operarios.join(', ');
        await registrarHistorial(ticket.id, req.user.id, 'asignacion', `Asignado a: ${nombres}`, { operarios });

        const { data: empresaData } = await supabaseAdmin
            .from('empresas').select('nombre').eq('id', empresa_id).single();

        if (perfiles?.length) {
            const results = await Promise.allSettled(
                perfiles.map(op => enviarEmailAsignacion({ operario: op, ticket, empresa: empresaData?.nombre || '' }))
            );
            results.forEach((r, i) => {
                if (r.status === 'rejected') {
                    console.warn(`[Email] Fallo enviando a ${perfiles[i]?.nombre}:`, r.reason?.message);
                }
            });
        }
    }

    res.status(201).json(ticket);
});

// ── EDITAR ───────────────────────────────────────────────────────────────────
router.put('/:id', authGuard, async (req, res) => {
    const { estado, prioridad, asunto, descripcion, dispositivo_id, notas } = req.body;
    const { data: old } = await supabaseAdmin
        .from('tickets_v2').select('*').eq('id', req.params.id).single();
    if (!old) return res.status(404).json({ error: 'Ticket no encontrado' });

    const updates = {};
    if (asunto         !== undefined) updates.asunto         = asunto;
    if (descripcion    !== undefined) updates.descripcion    = descripcion;
    if (notas          !== undefined) updates.notas          = notas;
    if (prioridad      !== undefined) updates.prioridad      = prioridad;
    if (dispositivo_id !== undefined) updates.dispositivo_id = dispositivo_id;

    if (estado && estado !== old.estado) {
        updates.estado = estado;
        if (estado === 'En curso'               && !old.started_at)   updates.started_at   = new Date().toISOString();
        if (estado === 'Completado'             && !old.completed_at) updates.completed_at = new Date().toISOString();
        if (estado === 'Pendiente de facturar'  && !old.completed_at) updates.completed_at = new Date().toISOString();
        if (estado === 'Facturado'              && !old.invoiced_at)  updates.invoiced_at  = new Date().toISOString();
        await registrarHistorial(
            req.params.id, req.user.id, 'estado',
            `Estado cambiado: "${old.estado}" → "${estado}"`,
            { de: old.estado, a: estado }
        );
    }

    if (prioridad && prioridad !== old.prioridad) {
        await registrarHistorial(
            req.params.id, req.user.id, 'prioridad',
            `Prioridad cambiada: "${old.prioridad}" → "${prioridad}"`,
            { de: old.prioridad, a: prioridad }
        );
    }

    const { data, error } = await supabaseAdmin
        .from('tickets_v2').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ── ELIMINAR ─────────────────────────────────────────────────────────────────
router.delete('/:id', authGuard, adminGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('tickets_v2').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ── ASIGNACIONES ─────────────────────────────────────────────────────────────
router.post('/:id/asignaciones', authGuard, async (req, res) => {
    const { operarios } = req.body;
    if (!operarios?.length) {
        return res.status(400).json({ error: 'Debes proporcionar al menos un operario.' });
    }

    const ticketId = req.params.id;
    const { data: existentes } = await supabaseAdmin
        .from('ticket_asignaciones').select('user_id').eq('ticket_id', ticketId);
    const existentesIds = new Set((existentes || []).map(a => a.user_id));
    const nuevos = operarios.filter(id => !existentesIds.has(id));

    const { error: upsertError } = await supabaseAdmin
        .from('ticket_asignaciones')
        .upsert(
            operarios.map(uid => ({ ticket_id: ticketId, user_id: uid, asignado_by: req.user.id })),
            { onConflict: 'ticket_id,user_id' }
        );
    if (upsertError) return res.status(500).json({ error: upsertError.message });

    if (nuevos.length > 0) {
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', nuevos);
        const nombres = perfiles?.map(p => p.nombre).join(', ') || nuevos.join(', ');
        await registrarHistorial(
            ticketId, req.user.id, 'asignacion',
            `${req.user.nombre || req.user.email} asignó a: ${nombres}`,
            { nuevos_operarios: nuevos, nombres }
        );

        try {
            const { data: ticket } = await supabaseAdmin
                .from('tickets_v2')
                .select('id, numero, asunto, descripcion, prioridad, estado, created_at, empresa_id, empresas(nombre)')
                .eq('id', ticketId)
                .single();

            const nuevosPerfiles = await getPerfilesConEmail(nuevos);

            if (ticket && nuevosPerfiles?.length) {
                const empresa = ticket.empresas?.nombre || '';
                const emailResults = await Promise.allSettled(
                    nuevosPerfiles.map(op => enviarEmailAsignacion({ operario: op, ticket, empresa }))
                );
                emailResults.forEach((r, i) => {
                    if (r.status === 'rejected') {
                        console.warn(`[Email] Fallo enviando a ${nuevosPerfiles[i]?.nombre}:`, r.reason?.message);
                    }
                });
            }
        } catch (emailErr) {
            console.warn('[Email] Error general en envío de asignación:', emailErr.message);
        }
    }

    const { data, error } = await supabaseAdmin
        .from('ticket_asignaciones')
        .select('id, ticket_id, user_id, asignado_at')
        .eq('ticket_id', ticketId)
        .in('user_id', operarios);
    if (error) return res.status(500).json({ error: error.message });

    const { data: perfiles } = await supabaseAdmin
        .from('profiles').select('id, nombre').in('id', operarios);
    const profileMap = {};
    perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });

    res.json(data.map(d => ({
        ...d,
        profiles: { id: d.user_id, nombre: profileMap[d.user_id] || '?' }
    })));
});

router.delete('/:id/asignaciones/:userId', authGuard, async (req, res) => {
    const { data: perfil } = await supabaseAdmin
        .from('profiles').select('nombre').eq('id', req.params.userId).single();
    const nombre = perfil?.nombre || req.params.userId;

    const { error } = await supabaseAdmin
        .from('ticket_asignaciones')
        .delete()
        .eq('ticket_id', req.params.id)
        .eq('user_id', req.params.userId);
    if (error) return res.status(500).json({ error: error.message });

    await registrarHistorial(
        req.params.id, req.user.id, 'desasignacion',
        `${req.user.nombre || req.user.email} quitó a ${nombre} del ticket`,
        { operario_id: req.params.userId, nombre }
    );
    res.json({ ok: true });
});

// ── NOTAS ────────────────────────────────────────────────────────────────────
router.put('/:id/notas', authGuard, async (req, res) => {
    const { notas } = req.body;
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .update({ notas })
        .eq('id', req.params.id)
        .select('id, notas')
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ── NOTAS INTERNAS ────────────────────────────────────────────────────────────
router.post('/:id/notas-internas', authGuard, async (req, res) => {
    const { texto } = req.body;
    if (!texto?.trim()) return res.status(400).json({ error: 'El texto no puede estar vacío.' });
    const { data, error } = await supabaseAdmin
        .from('ticket_historial')
        .insert({
            ticket_id: req.params.id,
            user_id: req.user.id,
            tipo: 'nota_interna',
            descripcion: texto.trim(),
            datos: {},
        })
        .select('id, tipo, descripcion, created_at, user_id')
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({
        ...data,
        profiles: { id: req.user.id, nombre: req.user.nombre || req.user.email },
    });
});

// ── COMENTARIOS ───────────────────────────────────────────────────────────────
router.get('/:id/comentarios', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('ticket_comentarios')
        .select(`
            id, contenido, editado, created_at, updated_at, user_id,
            ticket_comentarios_archivos(id, nombre_original, mime_type, tamanio, created_at)
        `)
        .eq('ticket_id', req.params.id)
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const userIds = [...new Set(data.map(c => c.user_id))];
    let profileMap = {};
    if (userIds.length) {
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', userIds);
        perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });
    }

    res.json(data.map(c => ({
        ...c,
        profiles: { id: c.user_id, nombre: profileMap[c.user_id] || '?' },
    })));
});

router.post('/:id/comentarios', authGuard, (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Archivo supera el límite de 50MB.' });
            return res.status(400).json({ error: err.message });
        }
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    const contenido = req.body.contenido?.trim() || '';
    const files = restoreFileNames(req.files || [], req);

    if (!contenido && !files.length) {
        return res.status(400).json({ error: 'El comentario debe tener texto o archivos.' });
    }

    const { data: ticket } = await supabaseAdmin
        .from('tickets_v2').select('id').eq('id', req.params.id).single();
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });

    const { data: comentario, error: comentarioError } = await supabaseAdmin
        .from('ticket_comentarios')
        .insert({ ticket_id: req.params.id, user_id: req.user.id, contenido: contenido || '', editado: false })
        .select('id, contenido, editado, created_at, user_id')
        .single();

    if (comentarioError) return res.status(500).json({ error: comentarioError.message });

    const archivosGuardados = [];
    for (const file of files) {
        try {
            const ext         = path.extname(file.originalname).toLowerCase() || '.bin';
            const safeName    = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
            const storagePath = `comentarios/${comentario.id}/${safeName}`;

            const { error: storageError } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

            if (storageError) { console.error('Storage error comentario:', storageError.message); continue; }

            const { data: archivoData } = await supabaseAdmin
                .from('ticket_comentarios_archivos')
                .insert({
                    comentario_id: comentario.id,
                    nombre_original: file.originalname,
                    nombre_storage: storagePath,
                    mime_type: file.mimetype,
                    tamanio: file.size,
                    subido_by: req.user.id,
                })
                .select().single();

            if (archivoData) archivosGuardados.push(archivoData);
        } catch (err) {
            console.error('Error subiendo archivo de comentario:', err.message);
        }
    }

    await registrarHistorial(
        req.params.id, req.user.id, 'comentario',
        `${req.user.nombre || req.user.email} añadió un comentario`,
        { comentario_id: comentario.id }
    );

    res.status(201).json({
        ...comentario,
        ticket_comentarios_archivos: archivosGuardados,
        profiles: { id: req.user.id, nombre: req.user.nombre || req.user.email },
    });
});

// ── ARCHIVOS DEL TICKET ───────────────────────────────────────────────────────
router.post('/:id/archivos', authGuard, (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo supera el límite de 50MB.' });
            return res.status(400).json({ error: `Error al procesar archivos: ${err.message}` });
        }
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    const files = restoreFileNames(req.files || [], req);
    if (!files?.length) return res.status(400).json({ error: 'No se han enviado archivos.' });

    const { data: ticket } = await supabaseAdmin
        .from('tickets_v2').select('id, numero').eq('id', req.params.id).single();
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });

    const results = [];
    const errores = [];

    for (const file of files) {
        try {
            const ext         = path.extname(file.originalname).toLowerCase() || '.bin';
            const safeName    = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
            const storagePath = `tickets/${req.params.id}/${safeName}`;

            const { error: storageError } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

            if (storageError) { errores.push(`${file.originalname}: ${storageError.message}`); continue; }

            const { data: archivoData, error: dbError } = await supabaseAdmin
                .from('ticket_archivos')
                .insert({
                    ticket_id: req.params.id,
                    nombre_original: file.originalname,
                    storage_path: storagePath,
                    mime_type: file.mimetype,
                    tamanio: file.size,
                    subido_by: req.user.id,
                })
                .select().single();

            if (dbError) {
                await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
                errores.push(`${file.originalname}: error al guardar en BD`);
                continue;
            }
            results.push(archivoData);
        } catch (err) {
            errores.push(`${file.originalname}: ${err.message}`);
        }
    }

    if (results.length > 0) {
        const nombres = results.map(r => r.nombre_original).join(', ');
        await registrarHistorial(
            req.params.id, req.user.id, 'archivo',
            `${req.user.nombre || req.user.email} adjuntó: ${nombres}`,
            { archivos: results.map(r => r.nombre_original) }
        );
    }

    if (results.length === 0) {
        return res.status(500).json({ error: `No se pudo subir ningún archivo. Errores: ${errores.join('; ')}` });
    }

    res.status(201).json(results);
});

// ── HORAS ─────────────────────────────────────────────────────────────────────
router.post('/:id/horas', authGuard, async (req, res) => {
    const { horas, descripcion, fecha } = req.body;
    if (!horas || isNaN(horas) || Number(horas) <= 0) {
        return res.status(400).json({ error: 'Horas inválidas.' });
    }

    const { data, error } = await supabaseAdmin
        .from('ticket_horas')
        .insert({
            ticket_id: req.params.id,
            user_id: req.user.id,
            horas: Number(horas),
            descripcion: descripcion || null,
            fecha: fecha || new Date().toISOString().split('T')[0],
        })
        .select().single();

    if (error) return res.status(500).json({ error: error.message });

    await registrarHistorial(
        req.params.id, req.user.id, 'horas',
        `${req.user.nombre || req.user.email} registró ${horas}h${descripcion ? ': ' + descripcion : ''}`,
        { horas, descripcion }
    );

    res.status(201).json({
        ...data,
        profiles: { id: req.user.id, nombre: req.user.nombre || req.user.email }
    });
});

module.exports = router;