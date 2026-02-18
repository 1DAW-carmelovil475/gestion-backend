// ============================================
// HOLA INFORMÁTICA — BACKEND SERVER
// Express + Supabase Auth + service_role
// ============================================

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================
// SUPABASE — dos clientes:
// - supabaseAdmin: service_role (bypasea RLS, para operaciones de backend)
// - supabasePublic: anon key (para verificar tokens de usuario)
// ============================================
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// MIDDLEWARES
// ============================================
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

// ============================================
// MIDDLEWARE: Verificar JWT de Supabase y cargar perfil
// ============================================
async function authGuard(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado. Token requerido.' });
    }

    const token = header.split(' ')[1];

    // Verificar el token con Supabase usando getUser()
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: 'Token inválido o expirado.' });
    }

    // Cargar el perfil (rol) del usuario
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('rol, activo, nombre')
        .eq('id', user.id)
        .single();

    if (profileError || !profile) {
        return res.status(401).json({ error: 'Perfil de usuario no encontrado.' });
    }

    if (!profile.activo) {
        return res.status(403).json({ error: 'Cuenta desactivada. Contacta con el administrador.' });
    }

    req.user = { id: user.id, email: user.email, ...profile };
    next();
}

// Solo admins pasan este middleware (usar después de authGuard)
function adminGuard(req, res, next) {
    if (req.user?.rol !== 'admin') {
        return res.status(403).json({ error: 'Acción reservada para administradores.' });
    }
    next();
}

// ============================================
// RUTA: Obtener perfil del usuario actual
// El frontend llama esto justo después del login
// ============================================
app.get('/api/auth/me', authGuard, (req, res) => {
    res.json({
        id:     req.user.id,
        email:  req.user.email,
        nombre: req.user.nombre,
        rol:    req.user.rol,
    });
});

// ============================================
// GESTIÓN DE USUARIOS (solo admin)
// ============================================

// Listar todos los usuarios
app.get('/api/usuarios', authGuard, adminGuard, async (req, res) => {
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre, rol, activo, created_at')
        .order('created_at');

    if (error) return res.status(500).json({ error: error.message });

    // Combinar con emails de auth.users
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) return res.status(500).json({ error: authError.message });

    const emailMap = {};
    authUsers.users.forEach(u => { emailMap[u.id] = u.email; });

    const result = profiles.map(p => ({ ...p, email: emailMap[p.id] || '—' }));
    res.json(result);
});

// Crear usuario (genera contraseña aleatoria y envía email)
app.post('/api/usuarios', authGuard, adminGuard, async (req, res) => {
    const { nombre, email, rol } = req.body;
    if (!nombre || !email || !rol) {
        return res.status(400).json({ error: 'Nombre, email y rol son obligatorios.' });
    }

    // Generar contraseña aleatoria segura
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    const password = Array.from(
        { length: 12 },
        () => chars[Math.floor(Math.random() * chars.length)]
    ).join('');

    // Crear usuario en Supabase Auth (con service_role)
    // email_confirm: true → no necesita confirmar email
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email:            email.toLowerCase().trim(),
        password,
        email_confirm:    true,
        user_metadata:    { nombre, rol },
    });

    if (authError) {
        if (authError.message.includes('already registered')) {
            return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
        }
        return res.status(500).json({ error: authError.message });
    }

    // El trigger de Supabase crea el profile automáticamente.
    // Pero actualizamos el rol por si el trigger tardara o fallara:
    await supabaseAdmin
        .from('profiles')
        .upsert({ id: authData.user.id, nombre, rol })
        .eq('id', authData.user.id);

    // Enviar email de bienvenida con las credenciales
    // Usamos la función de invitación de Supabase que manda el email nativo,
    // pero como queremos incluir la contraseña en texto plano usamos
    // la API de invitación con redirect personalizado.
    // Nota: Supabase enviará su propio email de "Magic Link". 
    // Para enviar la contraseña en texto plano necesitarás un SMTP propio
    // configurado en Supabase Dashboard → Authentication → Email Templates
    // O puedes usar el invite flow que ya notifica al usuario.

    // Alternativa simple: usar inviteUserByEmail para que Supabase 
    // envíe el email de acceso. El usuario establece su contraseña al hacer clic.
    // Si quieres enviar la contraseña generada, configura SMTP en Supabase y
    // personaliza el template, o usa nodemailer en el backend.

    res.status(201).json({
        id:     authData.user.id,
        email:  authData.user.email,
        nombre,
        rol,
        activo: true,
        // Solo en desarrollo: devolver password para mostrarlo al admin
        // En producción quitar esto y confiar solo en el email
        _tempPassword: password,
    });
});

// Editar usuario (nombre, rol, activo)
app.put('/api/usuarios/:id', authGuard, adminGuard, async (req, res) => {
    const { nombre, rol, activo } = req.body;
    const updates = {};
    if (nombre !== undefined) updates.nombre = nombre;
    if (rol    !== undefined) updates.rol    = rol;
    if (activo !== undefined) updates.activo = activo;

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Eliminar usuario
app.delete('/api/usuarios/:id', authGuard, adminGuard, async (req, res) => {
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
    }

    // Eliminar de auth.users (el CASCADE borra el profile)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: EMPRESAS
// ============================================
app.get('/api/empresas', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('empresas').select('*').order('nombre');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/empresas', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('empresas').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.put('/api/empresas/:id', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('empresas').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/empresas/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('empresas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: DISPOSITIVOS
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
    const { data, error } = await supabaseAdmin.from('dispositivos').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/dispositivos/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('dispositivos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: CONTRATOS
// ============================================
app.get('/api/contratos', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('contratos').select('*, empresas(nombre)').order('fecha_fin');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/contratos', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('contratos').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.delete('/api/contratos/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('contratos').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: FACTURAS
// ============================================
app.get('/api/facturas', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('facturas').select('*, empresas(nombre)').order('fecha', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/facturas', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('facturas').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.delete('/api/facturas/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('facturas').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// RUTAS: TICKETS
// ============================================
app.get('/api/tickets', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('tickets').select('*, empresas(nombre)').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.post('/api/tickets', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('tickets').insert(req.body).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

app.put('/api/tickets/:id', authGuard, async (req, res) => {
    const { data, error } = await supabaseAdmin.from('tickets').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.delete('/api/tickets/:id', authGuard, async (req, res) => {
    const { error } = await supabaseAdmin.from('tickets').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ============================================
// START
// ============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend corriendo en http://localhost:${PORT}`));