// ============================================
// HOLA INFORMÁTICA — BACKEND SERVER
// Express + Supabase Auth + service_role
// ============================================

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const path     = require('path');
const nodemailer = require('nodemailer');
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

// ── Helper: restaurar nombres reales desde el campo file_names ────────────────
function restoreFileNames(files, req) {
    let fileNames = null;
    try {
        if (req.body.file_names) {
            fileNames = JSON.parse(req.body.file_names);
        }
    } catch {}
    if (!fileNames || !Array.isArray(fileNames)) return files;
    return files.map((file, i) => {
        if (fileNames[i]) file.originalname = fileNames[i];
        return file;
    });
}

// ============================================
// CORS
// ============================================
const corsOptions = {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================
// NODEMAILER — TRANSPORTER
// Variables .env necesarias:
//   EMAIL_HOST=smtp.gmail.com
//   EMAIL_PORT=587
//   EMAIL_USER=tucorreo@gmail.com
//   EMAIL_PASS=tu_contraseña_de_aplicacion
//   EMAIL_FROM="Hola Informática <tucorreo@gmail.com>"
//   FRONTEND_URL=http://localhost:5173
// ============================================
const emailTransporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

emailTransporter.verify((err) => {
    if (err) console.warn('[Email] Transporter no disponible:', err.message);
    else     console.log('[Email] Transporter listo ✓');
});

async function enviarEmailAsignacion({ operario, ticket, empresa }) {
    if (!operario.email) return;

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const ticketUrl   = `${frontendUrl}/tickets`;

    const prioridadColor = {
        Urgente: '#dc2626',
        Alta:    '#d97706',
        Media:   '#2563eb',
        Baja:    '#059669',
    }[ticket.prioridad] || '#64748b';

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

        <!-- HEADER -->
        <tr>
          <td style="background:linear-gradient(135deg,#0047b3 0%,#0066ff 100%);padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;color:rgba(255,255,255,0.8);font-size:13px;text-transform:uppercase;letter-spacing:1px;">Sistema de Tickets</p>
                  <h1 style="margin:6px 0 0;color:white;font-size:22px;font-weight:700;">Hola Informática</h1>
                </td>
                <td align="right">
                  <div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:10px 16px;">
                    <span style="color:white;font-size:22px;">🎫</span>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 6px;color:#64748b;font-size:14px;">Hola, <strong style="color:#1e293b;">${operario.nombre || operario.email}</strong></p>
            <h2 style="margin:0 0 24px;color:#1e293b;font-size:18px;font-weight:600;">Se te ha asignado un nuevo ticket</h2>

            <!-- TICKET CARD -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
              <div style="background:#0047b3;padding:10px 20px;">
                <span style="background:rgba(255,255,255,0.2);color:white;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700;">#${ticket.numero}</span>
              </div>
              <div style="padding:20px;">
                <p style="margin:0 0 4px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Asunto</p>
                <p style="margin:0 0 18px;color:#1e293b;font-size:16px;font-weight:600;">${ticket.asunto}</p>

                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="50%" style="padding-bottom:12px;">
                      <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Empresa</p>
                      <p style="margin:0;color:#1e293b;font-size:13px;font-weight:500;">🏢 ${empresa || '—'}</p>
                    </td>
                    <td width="50%" style="padding-bottom:12px;">
                      <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Prioridad</p>
                      <p style="margin:0;">
                        <span style="background:${prioridadColor}18;color:${prioridadColor};padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;">${ticket.prioridad}</span>
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td width="50%">
                      <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Estado</p>
                      <p style="margin:0;color:#1e293b;font-size:13px;font-weight:500;">📋 ${ticket.estado}</p>
                    </td>
                    <td width="50%">
                      <p style="margin:0 0 3px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Fecha</p>
                      <p style="margin:0;color:#1e293b;font-size:13px;font-weight:500;">📅 ${new Date(ticket.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                    </td>
                  </tr>
                </table>

                ${ticket.descripcion ? `
                <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;">
                  <p style="margin:0 0 6px;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Descripción</p>
                  <p style="margin:0;color:#475569;font-size:13px;line-height:1.6;">${ticket.descripcion}</p>
                </div>` : ''}
              </div>
            </div>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:24px;">
              <a href="${ticketUrl}" style="display:inline-block;background:linear-gradient(135deg,#0047b3,#0066ff);color:white;text-decoration:none;padding:13px 32px;border-radius:8px;font-weight:600;font-size:15px;">
                Ver ticket →
              </a>
            </div>

            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;line-height:1.6;">
              Este correo fue enviado automáticamente porque se te asignó este ticket.<br>
              Si crees que es un error, contacta con tu administrador.
            </p>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
              © ${new Date().getFullYear()} Hola Informática · Sistema de gestión de tickets
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    await emailTransporter.sendMail({
        from:    process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to:      operario.email,
        subject: `🎫 Ticket #${ticket.numero} asignado: ${ticket.asunto}`,
        html,
    });
}

// ============================================
// HEALTH CHECK
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
// HELPERS
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

function calcularHorasTranscurridas(ticket) {
    if (!ticket.created_at) return 0;
    let fechaFin;
    if (ticket.estado === 'Facturado' && ticket.invoiced_at) {
        fechaFin = new Date(ticket.invoiced_at);
    } else if (ticket.estado === 'Completado' && ticket.completed_at) {
        fechaFin = new Date(ticket.completed_at);
    } else if (ticket.estado === 'Pendiente de facturar' && ticket.completed_at) {
        fechaFin = new Date(ticket.completed_at);
    } else {
        fechaFin = new Date();
    }
    const ms = fechaFin - new Date(ticket.created_at);
    return Math.max(0, Math.round(ms / 360000) / 10);
}

const STORAGE_BUCKET      = process.env.STORAGE_BUCKET      || 'ticket-archivos';
const CHAT_STORAGE_BUCKET = process.env.CHAT_STORAGE_BUCKET || 'chat-archivos';

// ── Helper: obtener perfiles con email desde auth.users ───────────────────────
// profiles no tiene columna email — el email vive en auth.users.
// Usamos listUsers() y cruzamos por id.
async function getPerfilesConEmail(ids) {
    if (!ids?.length) return [];

    const { data: perfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre, rol')
        .in('id', ids);

    if (!perfiles?.length) return [];

    // Obtener emails desde auth.users (service_role tiene acceso)
    const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = {};
    authData?.users?.forEach(u => { emailMap[u.id] = u.email; });

    return perfiles.map(p => ({
        ...p,
        email: emailMap[p.id] || null,
    }));
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
    const { nombre, email, rol, password } = req.body;
    if (!nombre || !email || !rol || !password) {
        return res.status(400).json({ error: 'Nombre, email, rol y contraseña son obligatorios.' });
    }
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
    res.status(201).json({ id: authData.user.id, email: authData.user.email, nombre, rol, activo: true });
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
// TICKETS V1 (legacy)
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
    if (estado === 'En curso')                updates.started_at   = updates.started_at   || new Date().toISOString();
    if (estado === 'Completado')              updates.completed_at = updates.completed_at || new Date().toISOString();
    if (estado === 'Pendiente de facturar')   updates.completed_at = updates.completed_at || new Date().toISOString();
    if (estado === 'Facturado')               updates.invoiced_at  = updates.invoiced_at  || new Date().toISOString();
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

    if (operarios?.length) {
        await supabaseAdmin.from('ticket_asignaciones').insert(
            operarios.map(uid => ({ ticket_id: ticket.id, user_id: uid, asignado_by: req.user.id }))
        );
        const perfiles = await getPerfilesConEmail(operarios);
        const nombres = perfiles?.map(p => p.nombre).join(', ') || operarios.join(', ');
        await registrarHistorial(ticket.id, req.user.id, 'asignacion', `Asignado a: ${nombres}`, { operarios });

        // Obtener empresa para el email
        const { data: empresaData } = await supabaseAdmin
            .from('empresas').select('nombre').eq('id', empresa_id).single();

        // Enviar email a cada operario asignado
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
        if (estado === 'En curso'                && !old.started_at)   updates.started_at   = new Date().toISOString();
        if (estado === 'Completado'              && !old.completed_at) updates.completed_at = new Date().toISOString();
        if (estado === 'Pendiente de facturar'   && !old.completed_at) updates.completed_at = new Date().toISOString();
        if (estado === 'Facturado'               && !old.invoiced_at)  updates.invoiced_at  = new Date().toISOString();
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
// TICKETS V2 — ASIGNACIONES + EMAIL
// ============================================
app.post('/api/v2/tickets/:id/asignaciones', authGuard, async (req, res) => {
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
    }

    // Enviar email a los nuevos operarios asignados
    if (nuevos.length > 0) {
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

app.delete('/api/v2/tickets/:id/asignaciones/:userId', authGuard, async (req, res) => {
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
// TICKETS V2 — NOTAS
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
// TICKETS V2 — NOTAS INTERNAS
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
// TICKETS V2 — COMENTARIOS
// ============================================
app.get('/api/v2/tickets/:id/comentarios', authGuard, async (req, res) => {
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

app.post('/api/v2/tickets/:id/comentarios', authGuard, (req, res, next) => {
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
        .insert({
            ticket_id: req.params.id,
            user_id:   req.user.id,
            contenido: contenido || '',
            editado:   false,
        })
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
                    comentario_id:   comentario.id,
                    nombre_original: file.originalname,
                    nombre_storage:  storagePath,
                    mime_type:       file.mimetype,
                    tamanio:         file.size,
                    subido_by:       req.user.id,
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

app.delete('/api/v2/comentarios/:comentarioId', authGuard, async (req, res) => {
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

app.get('/api/v2/comentarios/archivos/:archivoId/url', authGuard, async (req, res) => {
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

// ============================================
// TICKETS V2 — ARCHIVOS DEL TICKET
// ============================================
app.post('/api/v2/tickets/:id/archivos', authGuard, (req, res, next) => {
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
                    ticket_id:       req.params.id,
                    nombre_original: file.originalname,
                    storage_path:    storagePath,
                    mime_type:       file.mimetype,
                    tamanio:         file.size,
                    subido_by:       req.user.id,
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

app.get('/api/v2/archivos/:archivoId/url', authGuard, async (req, res) => {
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

app.delete('/api/v2/archivos/:archivoId', authGuard, async (req, res) => {
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
            ticket_id:   req.params.id,
            user_id:     req.user.id,
            horas:       Number(horas),
            descripcion: descripcion || null,
            fecha:       fecha || new Date().toISOString().split('T')[0],
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
        total:                 data.length,
        pendientes:            data.filter(t => t.estado === 'Pendiente').length,
        en_curso:              data.filter(t => t.estado === 'En curso').length,
        completados:           data.filter(t => t.estado === 'Completado').length,
        pendiente_facturar:    data.filter(t => t.estado === 'Pendiente de facturar').length,
        facturados:            data.filter(t => t.estado === 'Facturado').length,
        urgentes:              data.filter(t => t.prioridad === 'Urgente').length,
        ultimos_7_dias:        data.filter(t => new Date(t.created_at) >= hace7dias).length,
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
        .from('tickets_v2').select('id, estado, ticket_asignaciones(user_id)');

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
                    id: a.user_id, nombre: profileMap[a.user_id] || '?',
                    tickets_totales: 0, tickets_completados: 0, tickets_pendientes: 0,
                    horas_totales: 0, tiempos_resolucion: [],
                };
            }
            map[a.user_id].tickets_totales++;
            if (['Completado', 'Pendiente de facturar', 'Facturado'].includes(ticket.estado)) {
                map[a.user_id].tickets_completados++;
                const fechaCierre = ticket.invoiced_at || ticket.completed_at;
                if (ticket.created_at && fechaCierre) {
                    map[a.user_id].tiempos_resolucion.push(
                        (new Date(fechaCierre) - new Date(ticket.created_at)) / 3600000
                    );
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
            if (['Pendiente', 'En curso'].includes(ticket.estado)) map[a.user_id].tickets_pendientes++;
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
                id: t.empresa_id, nombre: t.empresas?.nombre,
                total: 0, pendientes: 0, en_curso: 0, completados: 0,
                pendiente_facturar: 0, facturados: 0, urgentes: 0,
            };
        }
        map[t.empresa_id].total++;
        if (t.estado === 'Pendiente')              map[t.empresa_id].pendientes++;
        if (t.estado === 'En curso')               map[t.empresa_id].en_curso++;
        if (t.estado === 'Completado')             map[t.empresa_id].completados++;
        if (t.estado === 'Pendiente de facturar')  map[t.empresa_id].pendiente_facturar++;
        if (t.estado === 'Facturado')              map[t.empresa_id].facturados++;
        if (t.prioridad === 'Urgente')             map[t.empresa_id].urgentes++;
    });

    res.json(Object.values(map).sort((a, b) => b.total - a.total));
});

// ============================================
// CHAT — CANALES
// ============================================
app.get('/api/v2/chat/canales', authGuard, async (req, res) => {
    const { data: memberships, error: memberError } = await supabaseAdmin
        .from('chat_canales_miembros')
        .select('canal_id')
        .eq('user_id', req.user.id);

    if (memberError) return res.status(500).json({ error: memberError.message });

    const canalIds = memberships.map(m => m.canal_id);
    if (!canalIds.length) return res.json([]);

    const { data: canales, error } = await supabaseAdmin
        .from('chat_canales')
        .select(`
            id, nombre, descripcion, tipo, created_at,
            chat_canales_miembros(user_id, rol, joined_at)
        `)
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

app.post('/api/v2/chat/canales', authGuard, async (req, res) => {
    const { nombre, descripcion, tipo, miembros } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const tipoCanal = tipo || 'canal';

    const { data: canal, error } = await supabaseAdmin
        .from('chat_canales')
        .insert({ nombre: nombre.toLowerCase().replace(/\s+/g, '-'), descripcion: descripcion || null, tipo: tipoCanal, creado_por: req.user.id })
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
            if (uid !== req.user.id) {
                miembrosInsert.push({ canal_id: canal.id, user_id: uid, rol: 'miembro' });
            }
        });
    }

    await supabaseAdmin.from('chat_canales_miembros').insert(miembrosInsert);

    const { data: canalCompleto } = await supabaseAdmin
        .from('chat_canales')
        .select(`id, nombre, descripcion, tipo, created_at, chat_canales_miembros(user_id, rol, joined_at)`)
        .eq('id', canal.id)
        .single();

    res.status(201).json(canalCompleto);
});

app.put('/api/v2/chat/canales/:id', authGuard, adminGuard, async (req, res) => {
    const { nombre, descripcion, miembros } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });

    const { data: canal, error: canalError } = await supabaseAdmin
        .from('chat_canales')
        .update({ nombre: nombre.toLowerCase().replace(/\s+/g, '-'), descripcion: descripcion || null })
        .eq('id', req.params.id)
        .select()
        .single();

    if (canalError) return res.status(500).json({ error: canalError.message });

    if (Array.isArray(miembros)) {
        await supabaseAdmin
            .from('chat_canales_miembros')
            .delete()
            .eq('canal_id', req.params.id)
            .neq('user_id', req.user.id);

        if (miembros.length > 0) {
            const inserts = miembros
                .filter(uid => uid !== req.user.id)
                .map(uid => ({ canal_id: req.params.id, user_id: uid, rol: 'miembro' }));
            if (inserts.length > 0) {
                await supabaseAdmin
                    .from('chat_canales_miembros')
                    .upsert(inserts, { onConflict: 'canal_id,user_id' });
            }
        }
    }

    const { data: canalCompleto, error: fetchError } = await supabaseAdmin
        .from('chat_canales')
        .select(`id, nombre, descripcion, tipo, created_at, chat_canales_miembros(user_id, rol, joined_at)`)
        .eq('id', req.params.id)
        .single();

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
            ...m,
            profiles: { id: m.user_id, nombre: profileMap[m.user_id] || '?' },
        })),
    });
});

app.delete('/api/v2/chat/canales/:id', authGuard, adminGuard, async (req, res) => {
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

app.post('/api/v2/chat/canales/:id/miembros', authGuard, async (req, res) => {
    const { miembros } = req.body;
    if (!miembros?.length) return res.status(400).json({ error: 'Debes proporcionar al menos un miembro.' });

    const inserts = miembros.map(uid => ({ canal_id: req.params.id, user_id: uid, rol: 'miembro' }));
    const { error } = await supabaseAdmin
        .from('chat_canales_miembros')
        .upsert(inserts, { onConflict: 'canal_id,user_id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// CHAT — MENSAJES
// ============================================
app.get('/api/v2/chat/canales/:id/mensajes', authGuard, async (req, res) => {
    const { limit = 100, before } = req.query;

    const { data: membership } = await supabaseAdmin
        .from('chat_canales_miembros')
        .select('canal_id')
        .eq('canal_id', req.params.id)
        .eq('user_id', req.user.id)
        .single();

    if (!membership) return res.status(403).json({ error: 'No eres miembro de este canal.' });

    let query = supabaseAdmin
        .from('chat_mensajes')
        .select(`
            id, contenido, ticket_ref_id, anclado, editado, created_at, user_id,
            chat_mensajes_archivos(id, nombre_original, mime_type, tamanio)
        `)
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

app.post('/api/v2/chat/canales/:id/mensajes', authGuard, (req, res, next) => {
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
        .select('canal_id')
        .eq('canal_id', req.params.id)
        .eq('user_id', req.user.id)
        .single();

    if (!membership) return res.status(403).json({ error: 'No eres miembro de este canal.' });

    const { data: mensaje, error: mensajeError } = await supabaseAdmin
        .from('chat_mensajes')
        .insert({
            canal_id:      req.params.id,
            user_id:       req.user.id,
            contenido:     contenido || '',
            ticket_ref_id: ticket_ref_id || null,
            anclado:       false,
            editado:       false,
        })
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
                .insert({
                    mensaje_id:      mensaje.id,
                    nombre_original: file.originalname,
                    nombre_storage:  storagePath,
                    mime_type:       file.mimetype,
                    tamanio:         file.size,
                })
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

app.patch('/api/v2/chat/mensajes/:mensajeId', authGuard, async (req, res) => {
    const { contenido } = req.body;
    if (!contenido?.trim()) {
        return res.status(400).json({ error: 'El contenido no puede estar vacío.' });
    }

    const { data: mensaje } = await supabaseAdmin
        .from('chat_mensajes').select('user_id').eq('id', req.params.mensajeId).single();

    if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' });
    if (mensaje.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Solo puedes editar tus propios mensajes.' });
    }

    const { data, error } = await supabaseAdmin
        .from('chat_mensajes')
        .update({ contenido: contenido.trim(), editado: true })
        .eq('id', req.params.mensajeId)
        .select('id, contenido, editado, anclado, created_at, user_id')
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.patch('/api/v2/chat/mensajes/:mensajeId/pin', authGuard, async (req, res) => {
    const { anclado } = req.body;
    if (typeof anclado !== 'boolean') {
        return res.status(400).json({ error: 'El campo "anclado" debe ser booleano.' });
    }

    const { data, error } = await supabaseAdmin
        .from('chat_mensajes')
        .update({ anclado })
        .eq('id', req.params.mensajeId)
        .select('id, anclado')
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/v2/chat/mensajes/:mensajeId', authGuard, async (req, res) => {
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

app.get('/api/v2/chat/archivos/:archivoId/url', authGuard, async (req, res) => {
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

// ============================================
// CATCH-ALL — JSON para rutas /api/ no encontradas
// ============================================
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
});

// Error handler global
app.use((err, req, res, next) => {
    console.error('Error no controlado:', err);
    res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`   Backend corriendo en http://localhost:${PORT}`);
    console.log(`   Supabase URL: ${process.env.SUPABASE_URL}`);
    console.log(`   Frontend: ${process.env.FRONTEND_URL || '*'}`);
    console.log(`   Bucket tickets: ${STORAGE_BUCKET}`);
    console.log(`   Bucket chat:    ${CHAT_STORAGE_BUCKET}`);
});