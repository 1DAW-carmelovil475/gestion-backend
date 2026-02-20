// ============================================
// HOLA INFORMÁTICA — BACKEND SERVER
// Express + Supabase Auth + service_role
// ============================================

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        // Tipos permitidos
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

// ============================================
// CORS — IMPORTANTE: configurar correctamente
// ============================================
const corsOptions = {
    origin: function (origin, callback) {
        const allowed = (process.env.FRONTEND_URL || '*').split(',').map(u => u.trim());
        if (allowed.includes('*') || !origin || allowed.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================
// HEALTH CHECK — siempre devuelve JSON
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ============================================
// AUTH MIDDLEWARES
// ============================================
async function authGuard(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado. Token requerido.' });
    }
    const token = header.split(' ')[1];
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Token inválido o expirado.' });

    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles').select('rol, activo, nombre').eq('id', user.id).single();

    if (profileError || !profile) return res.status(401).json({ error: 'Perfil no encontrado.' });
    if (!profile.activo) return res.status(403).json({ error: 'Cuenta desactivada.' });

    req.user = { id: user.id, email: user.email, ...profile };
    next();
}

function adminGuard(req, res, next) {
    if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores.' });
    next();
}

// ============================================
// HELPER: registrar historial
// ============================================
async function registrarHistorial(ticketId, userId, tipo, descripcion, datos = {}) {
    const { error } = await supabaseAdmin.from('ticket_historial').insert({
        ticket_id: ticketId,
        user_id: userId,
        tipo,
        descripcion,
        datos,
    });
    if (error) console.error('Error registrando historial:', error.message);
}

// ============================================
// HELPER: calcular horas transcurridas
// Congela el tiempo si el ticket está Completado o Facturado
// ============================================
function calcularHorasTranscurridas(ticket) {
    if (!ticket.created_at) return 0;

    // Si está completado o facturado, el tiempo se congela en el momento de cierre
    let fechaFin;
    if (ticket.estado === 'Facturado' && ticket.invoiced_at) {
        fechaFin = new Date(ticket.invoiced_at);
    } else if (ticket.estado === 'Completado' && ticket.completed_at) {
        fechaFin = new Date(ticket.completed_at);
    } else {
        fechaFin = new Date(); // sigue corriendo
    }

    const ms = fechaFin - new Date(ticket.created_at);
    return Math.max(0, Math.round(ms / 360000) / 10); // redondear a 1 decimal
}

// ============================================
// AUTH
// ============================================
app.get('/api/auth/me', authGuard, (req, res) => {
    res.json({
        id: req.user.id,
        email: req.user.email,
        nombre: req.user.nombre,
        rol: req.user.rol,
    });
});

// ============================================
// USUARIOS (solo admin)
// ============================================
app.get('/api/usuarios', authGuard, adminGuard, async (req, res) => {
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles').select('id, nombre, rol, activo, created_at').order('created_at');
    if (error) return res.status(500).json({ error: error.message });

    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) return res.status(500).json({ error: authError.message });

    const emailMap = {};
    authUsers.users.forEach(u => { emailMap[u.id] = u.email; });
    res.json(profiles.map(p => ({ ...p, email: emailMap[p.id] || '—' })));
});

app.post('/api/usuarios', authGuard, adminGuard, async (req, res) => {
    const { nombre, email, rol } = req.body;
    if (!nombre || !email || !rol) {
        return res.status(400).json({ error: 'Nombre, email y rol son obligatorios.' });
    }

    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    const password = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.toLowerCase().trim(),
        password,
        email_confirm: true,
        user_metadata: { nombre, rol },
    });

    if (authError) {
        if (authError.message.includes('already registered')) {
            return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
        }
        return res.status(500).json({ error: authError.message });
    }

    await supabaseAdmin.from('profiles').upsert(
        { id: authData.user.id, nombre, rol },
        { onConflict: 'id' }
    );

    res.status(201).json({
        id: authData.user.id,
        email: authData.user.email,
        nombre, rol, activo: true,
        _tempPassword: password,
    });
});

app.put('/api/usuarios/:id', authGuard, adminGuard, async (req, res) => {
    const { nombre, rol, activo } = req.body;
    const updates = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (rol    !== undefined) updates.rol    = rol;
    if (activo !== undefined) updates.activo = activo;
    const { data, error } = await supabaseAdmin
        .from('profiles').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/usuarios/:id', authGuard, adminGuard, async (req, res) => {
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// EMPRESAS
// ============================================
app.get('/api/empresas', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('empresas').select('*').order('nombre');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/empresas', authGuard, async (req, res) => {
    const { nombre, cif } = req.body;
    if (!nombre || !cif) return res.status(400).json({ error: 'Nombre y CIF son obligatorios.' });
    const { data, error } = await supabaseAdmin.from('empresas').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.put('/api/empresas/:id', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('empresas').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/empresas/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('empresas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// DISPOSITIVOS
// ============================================
app.get('/api/dispositivos', authGuard, async (req, res) => {
    const { empresa_id, categoria } = req.query;
    let query = supabaseAdmin.from('dispositivos').select('*').order('nombre');
    if (empresa_id) query = query.eq('empresa_id', empresa_id);
    if (categoria)  query = query.eq('categoria', categoria);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/dispositivos', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('dispositivos').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.put('/api/dispositivos/:id', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('dispositivos').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/dispositivos/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('dispositivos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// TICKETS V1 (legacy — panel principal)
// ============================================
app.get('/api/tickets', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .select('id, numero, asunto, descripcion, prioridad, estado, created_at, empresa_id, empresas(id, nombre)')
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// POST legacy (redirige a v2)
app.post('/api/tickets', authGuard, async (req, res) => {
    const { empresa_id, asunto, descripcion, prioridad, estado } = req.body;
    if (!empresa_id || !asunto) return res.status(400).json({ error: 'empresa_id y asunto son obligatorios.' });
    const { data, error } = await supabaseAdmin
        .from('tickets_v2')
        .insert({ empresa_id, asunto, descripcion, prioridad: prioridad || 'Media', estado: estado || 'Pendiente', created_by: req.user.id })
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    await registrarHistorial(data.id, req.user.id, 'creacion', `Ticket creado por ${req.user.nombre || req.user.email}`);
    res.status(201).json(data);
});

app.put('/api/tickets/:id', authGuard, async (req, res) => {
    const { estado } = req.body;
    const updates = { ...req.body };
    if (estado === 'En curso')   updates.started_at   = updates.started_at   || new Date().toISOString();
    if (estado === 'Completado') updates.completed_at = updates.completed_at || new Date().toISOString();
    if (estado === 'Facturado')  updates.invoiced_at  = updates.invoiced_at  || new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('tickets_v2').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/tickets/:id', authGuard, adminGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('tickets_v2').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// TICKETS V2 — OPERARIOS
// ============================================
app.get('/api/v2/operarios', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre, rol, activo')
        .in('rol', ['admin', 'trabajador'])
        .eq('activo', true)
        .order('nombre');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ============================================
// TICKETS V2 — CRUD
// ============================================
app.get('/api/v2/tickets', authGuard, async (req, res) => {
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

    // Resolver nombres de operarios
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
        // ✅ FIX: tiempo congelado al completar/facturar
        horas_transcurridas: calcularHorasTranscurridas(t),
    }));

    // Filtrar por operario si se especifica
    if (operario_id) {
        result = result.filter(t => t.ticket_asignaciones?.some(a => a.user_id === operario_id));
    }

    // Búsqueda
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

app.get('/api/v2/tickets/:id', authGuard, async (req, res) => {
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

    // Resolver nombres
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
            .map(h => ({
                ...h, profiles: { nombre: profileMap[h.user_id] || 'Sistema' }
            }));
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

    // ✅ FIX: tiempo congelado al completar/facturar
    data.horas_transcurridas = calcularHorasTranscurridas(data);
    data.horas_totales = (data.ticket_horas || []).reduce((s, h) => s + Number(h.horas), 0);

    res.json(data);
});

app.post('/api/v2/tickets', authGuard, async (req, res) => {
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

    // Asignar operarios y registrar en historial
    if (operarios?.length) {
        await supabaseAdmin.from('ticket_asignaciones').insert(
            operarios.map(uid => ({ ticket_id: ticket.id, user_id: uid, asignado_by: req.user.id }))
        );

        // Obtener nombres para el historial
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', operarios);
        const nombres = perfiles?.map(p => p.nombre).join(', ') || operarios.join(', ');

        await registrarHistorial(
            ticket.id, req.user.id, 'asignacion',
            `Asignado a: ${nombres}`,
            { operarios }
        );
    }

    res.status(201).json(ticket);
});

app.put('/api/v2/tickets/:id', authGuard, async (req, res) => {
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
        // ✅ FIX: timestamps para congelar el tiempo
        if (estado === 'En curso'   && !old.started_at)   updates.started_at   = new Date().toISOString();
        if (estado === 'Completado' && !old.completed_at) updates.completed_at = new Date().toISOString();
        if (estado === 'Facturado'  && !old.invoiced_at)  updates.invoiced_at  = new Date().toISOString();

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

app.delete('/api/v2/tickets/:id', authGuard, adminGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('tickets_v2').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// TICKETS V2 — ASIGNACIONES
// ✅ FIX: registrar en historial al asignar/desasignar
// ============================================
app.post('/api/v2/tickets/:id/asignaciones', authGuard, async (req, res) => {
    const { operarios } = req.body;
    if (!operarios?.length) {
        return res.status(400).json({ error: 'Debes proporcionar al menos un operario.' });
    }

    const ticketId = req.params.id;

    // Obtener asignaciones actuales para detectar nuevas
    const { data: existentes } = await supabaseAdmin
        .from('ticket_asignaciones')
        .select('user_id')
        .eq('ticket_id', ticketId);
    const existentesIds = new Set((existentes || []).map(a => a.user_id));
    const nuevos = operarios.filter(id => !existentesIds.has(id));

    // Upsert
    const { error: upsertError } = await supabaseAdmin
        .from('ticket_asignaciones')
        .upsert(
            operarios.map(uid => ({ ticket_id: ticketId, user_id: uid, asignado_by: req.user.id })),
            { onConflict: 'ticket_id,user_id' }
        );

    if (upsertError) return res.status(500).json({ error: upsertError.message });

    // ✅ Registrar en historial solo los nuevos
    if (nuevos.length > 0) {
        const { data: perfiles } = await supabaseAdmin
            .from('profiles').select('id, nombre').in('id', nuevos);
        const nombres = perfiles?.map(p => p.nombre).join(', ') || nuevos.join(', ');

        await registrarHistorial(
            ticketId, req.user.id, 'asignacion',
            `${req.user.nombre || req.user.email} asignó a: ${nombres}`,
            { nuevos_operarios: nuevos, nombres }
        );
    }

    // Leer resultado
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

app.delete('/api/v2/tickets/:id/asignaciones/:userId', authGuard, async (req, res) => {
    // ✅ Registrar desasignación en historial
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

// ============================================
// TICKETS V2 — NOTAS (bloc de notas)
// ============================================
app.put('/api/v2/tickets/:id/notas', authGuard, async (req, res) => {
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

// ============================================
// TICKETS V2 — NOTAS INTERNAS (chat equipo)
// ============================================
app.post('/api/v2/tickets/:id/notas-internas', authGuard, async (req, res) => {
    const { texto } = req.body;
    if (!texto?.trim()) {
        return res.status(400).json({ error: 'El texto no puede estar vacío.' });
    }

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

// ============================================
// TICKETS V2 — ARCHIVOS
// ✅ FIX: bucket name consistente, mejor manejo de errores
// ============================================
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'ticket-archivos';

app.post('/api/v2/tickets/:id/archivos', authGuard, (req, res, next) => {
    upload.array('files', 10)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'El archivo supera el límite de 50MB.' });
            }
            return res.status(400).json({ error: `Error al procesar archivos: ${err.message}` });
        }
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    const files = req.files;
    if (!files?.length) {
        return res.status(400).json({ error: 'No se han enviado archivos.' });
    }

    // Verificar que el ticket existe
    const { data: ticket } = await supabaseAdmin
        .from('tickets_v2').select('id, numero').eq('id', req.params.id).single();
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado.' });

    const results = [];
    const errores = [];

    for (const file of files) {
        try {
            const ext = path.extname(file.originalname).toLowerCase() || '.bin';
            const safeName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}${ext}`;
            const storagePath = `tickets/${req.params.id}/${safeName}`;

            const { error: storageError } = await supabaseAdmin.storage
                .from(STORAGE_BUCKET)
                .upload(storagePath, file.buffer, {
                    contentType: file.mimetype,
                    upsert: false,
                });

            if (storageError) {
                console.error('Error subiendo a storage:', storageError);
                errores.push(`${file.originalname}: ${storageError.message}`);
                continue;
            }

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
                // Si falla la BD, limpiar el archivo de storage
                await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
                errores.push(`${file.originalname}: error al guardar en BD`);
                continue;
            }

            results.push(archivoData);
        } catch (err) {
            errores.push(`${file.originalname}: ${err.message}`);
        }
    }

    // Registrar en historial
    if (results.length > 0) {
        const nombres = results.map(r => r.nombre_original).join(', ');
        await registrarHistorial(
            req.params.id, req.user.id, 'archivo',
            `${req.user.nombre || req.user.email} adjuntó: ${nombres}`,
            { archivos: results.map(r => r.nombre_original) }
        );
    }

    if (results.length === 0) {
        return res.status(500).json({
            error: `No se pudo subir ningún archivo. Errores: ${errores.join('; ')}`
        });
    }

    res.status(201).json(results);
});

app.get('/api/v2/archivos/:archivoId/url', authGuard, async (req, res) => {
    const { data: archivo, error } = await supabaseAdmin
        .from('ticket_archivos')
        .select('storage_path, nombre_original, mime_type')
        .eq('id', req.params.archivoId)
        .single();

    if (error || !archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

    const { data: urlData, error: urlError } = await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(archivo.storage_path, 3600); // 1 hora

    if (urlError) return res.status(500).json({ error: urlError.message });

    res.json({
        url: urlData.signedUrl,
        nombre: archivo.nombre_original,
        mime_type: archivo.mime_type,
    });
});

app.delete('/api/v2/archivos/:archivoId', authGuard, async (req, res) => {
    const { data: archivo } = await supabaseAdmin
        .from('ticket_archivos').select('*').eq('id', req.params.archivoId).single();
    if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });

    // Solo admin o quien lo subió puede eliminarlo
    if (archivo.subido_by !== req.user.id && req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Sin permisos para eliminar este archivo.' });
    }

    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([archivo.storage_path]);
    await supabaseAdmin.from('ticket_archivos').delete().eq('id', req.params.archivoId);
    res.json({ ok: true });
});

// ============================================
// TICKETS V2 — HORAS
// ============================================
app.post('/api/v2/tickets/:id/horas', authGuard, async (req, res) => {
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

app.delete('/api/v2/horas/:horaId', authGuard, async (req, res) => {
    const { data: hora } = await supabaseAdmin
        .from('ticket_horas').select('user_id').eq('id', req.params.horaId).single();
    if (!hora) return res.status(404).json({ error: 'No encontrado' });
    if (hora.user_id !== req.user.id && req.user.rol !== 'admin') {
        return res.status(403).json({ error: 'Sin permisos.' });
    }
    await supabaseAdmin.from('ticket_horas').delete().eq('id', req.params.horaId);
    res.json({ ok: true });
});

// ============================================
// ESTADÍSTICAS (solo admin)
// ============================================
app.get('/api/v2/estadisticas/resumen', authGuard, adminGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('tickets_v2').select('estado, prioridad, created_at');
    if (error) return res.status(500).json({ error: error.message });

    const now = new Date();
    const hace7dias = new Date(now - 7 * 86400000);

    res.json({
        total:           data.length,
        pendientes:      data.filter(t => t.estado === 'Pendiente').length,
        en_curso:        data.filter(t => t.estado === 'En curso').length,
        completados:     data.filter(t => t.estado === 'Completado').length,
        facturados:      data.filter(t => t.estado === 'Facturado').length,
        urgentes:        data.filter(t => t.prioridad === 'Urgente').length,
        ultimos_7_dias:  data.filter(t => new Date(t.created_at) >= hace7dias).length,
    });
});

app.get('/api/v2/estadisticas/operarios', authGuard, adminGuard, async (req, res) => {
    const { desde, hasta } = req.query;

    let query = supabaseAdmin
        .from('tickets_v2')
        .select(`id, estado, prioridad, created_at, completed_at, invoiced_at, ticket_asignaciones(user_id), ticket_horas(user_id, horas)`);
    if (desde) query = query.gte('created_at', desde);
    if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');

    const { data: tickets, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const { data: todos } = await supabaseAdmin
        .from('tickets_v2')
        .select('id, estado, ticket_asignaciones(user_id)');

    const userIds = new Set();
    tickets?.forEach(t => t.ticket_asignaciones?.forEach(a => userIds.add(a.user_id)));
    todos?.forEach(t => t.ticket_asignaciones?.forEach(a => userIds.add(a.user_id)));

    if (!userIds.size) return res.json([]);

    const { data: perfiles } = await supabaseAdmin
        .from('profiles').select('id, nombre').in('id', [...userIds]);
    const profileMap = {};
    perfiles?.forEach(p => { profileMap[p.id] = p.nombre; });

    const map = {};

    tickets?.forEach(ticket => {
        ticket.ticket_asignaciones?.forEach(a => {
            if (!map[a.user_id]) {
                map[a.user_id] = {
                    id: a.user_id,
                    nombre: profileMap[a.user_id] || '?',
                    tickets_totales: 0,
                    tickets_completados: 0,
                    tickets_pendientes: 0,
                    horas_totales: 0,
                    tiempos_resolucion: [],
                };
            }
            map[a.user_id].tickets_totales++;
            if (['Completado', 'Facturado'].includes(ticket.estado)) {
                map[a.user_id].tickets_completados++;
                const fechaCierre = ticket.invoiced_at || ticket.completed_at;
                if (ticket.created_at && fechaCierre) {
                    const horas = (new Date(fechaCierre) - new Date(ticket.created_at)) / 3600000;
                    map[a.user_id].tiempos_resolucion.push(horas);
                }
            }
        });
        ticket.ticket_horas?.forEach(h => {
            if (map[h.user_id]) map[h.user_id].horas_totales += Number(h.horas);
        });
    });

    todos?.forEach(ticket => {
        ticket.ticket_asignaciones?.forEach(a => {
            if (!map[a.user_id]) return;
            if (['Pendiente', 'En curso'].includes(ticket.estado)) {
                map[a.user_id].tickets_pendientes++;
            }
        });
    });

    res.json(Object.values(map).map(op => ({
        ...op,
        tiempo_promedio_horas: op.tiempos_resolucion.length
            ? op.tiempos_resolucion.reduce((a, b) => a + b, 0) / op.tiempos_resolucion.length
            : null,
    })));
});

app.get('/api/v2/estadisticas/empresas', authGuard, adminGuard, async (req, res) => {
    const { desde, hasta } = req.query;
    let query = supabaseAdmin
        .from('tickets_v2')
        .select('empresa_id, estado, prioridad, created_at, empresas(nombre)');
    if (desde) query = query.gte('created_at', desde);
    if (hasta) query = query.lte('created_at', hasta + 'T23:59:59');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const map = {};
    data?.forEach(t => {
        if (!map[t.empresa_id]) {
            map[t.empresa_id] = {
                id: t.empresa_id,
                nombre: t.empresas?.nombre,
                total: 0, pendientes: 0, en_curso: 0,
                completados: 0, facturados: 0, urgentes: 0,
            };
        }
        map[t.empresa_id].total++;
        if (t.estado === 'Pendiente')  map[t.empresa_id].pendientes++;
        if (t.estado === 'En curso')   map[t.empresa_id].en_curso++;
        if (t.estado === 'Completado') map[t.empresa_id].completados++;
        if (t.estado === 'Facturado')  map[t.empresa_id].facturados++;
        if (t.prioridad === 'Urgente') map[t.empresa_id].urgentes++;
    });

    res.json(Object.values(map).sort((a, b) => b.total - a.total));
});

// ============================================
// CATCH-ALL — devuelve JSON para rutas no encontradas
// Evita que Express devuelva HTML en rutas /api/ inexistentes
// ============================================
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// Error handler global — siempre JSON
app.use((err, req, res, next) => {
    console.error('Error no controlado:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Backend corriendo en http://localhost:${PORT}`);
    console.log(`   Supabase URL: ${process.env.SUPABASE_URL}`);
    console.log(`   Frontend: ${process.env.FRONTEND_URL || '*'}`);
});