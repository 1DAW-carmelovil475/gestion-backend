const express      = require('express');
const router       = express.Router();
const supabaseAdmin = require('../supabase');
const { authGuard, adminGuard } = require('../middleware/auth');

router.get('/', authGuard, adminGuard, async (req, res) => {
    const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre, rol, activo, created_at, empresa_id, empresas(id, nombre, contactos)')
        .order('created_at');
    if (error) return res.status(500).json({ error: error.message });

    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) return res.status(500).json({ error: authError.message });

    const emailMap = {};
    authUsers.users.forEach(u => { emailMap[u.id] = u.email; });
    res.json(profiles.map(p => {
        const email = emailMap[p.id] || '—';
        const contactos = p.empresas?.contactos || [];
        const contacto = contactos.find(c => c.email && c.email.toLowerCase() === email.toLowerCase())
                      || contactos.find(c => c.nombre && p.nombre && c.nombre.trim().toLowerCase() === p.nombre.trim().toLowerCase());
        return {
            ...p,
            email,
            empresa_nombre: p.empresas?.nombre || null,
            telefono: contacto?.telefono || '',
        };
    }));
});

const ROLES_VALIDOS = ['admin', 'gestor', 'trabajador', 'cliente'];

function sanitize(str, max = 200) {
    if (!str) return null;
    return String(str).trim().replace(/<[^>]*>/g, '').substring(0, max) || null;
}

router.post('/', authGuard, adminGuard, async (req, res) => {
    const nombreClean = sanitize(req.body.nombre, 100);
    const emailClean  = (req.body.email || '').toLowerCase().trim();
    const rol         = ROLES_VALIDOS.includes(req.body.rol) ? req.body.rol : null;
    const { password, empresa_id, telefono } = req.body;

    if (!nombreClean || !emailClean || !rol || !password) {
        return res.status(400).json({ error: 'Nombre, email, rol y contraseña son obligatorios.' });
    }
    if (rol === 'cliente' && !empresa_id) {
        return res.status(400).json({ error: 'El rol cliente requiere seleccionar una empresa.' });
    }

    const nombre = nombreClean;
    const email  = emailClean;

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre, rol },
    });
    if (authError) {
        console.error('[Usuarios] Error creando auth user:', authError);
        if (authError.message.includes('already registered')) {
            return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
        }
        return res.status(500).json({ error: authError.message });
    }

    const profileData = { id: authData.user.id, nombre, rol };
    if (rol === 'cliente' && empresa_id) profileData.empresa_id = empresa_id;

    await supabaseAdmin.from('profiles').upsert(profileData, { onConflict: 'id' });

    // Si es cliente, añadir como contacto a la empresa
    if (rol === 'cliente' && empresa_id) {
        const { data: empresa } = await supabaseAdmin
            .from('empresas').select('contactos').eq('id', empresa_id).single();

        const contactosActuales = empresa?.contactos || [];
        const nuevoContacto = {
            nombre: nombre,
            email: email.toLowerCase().trim(),
            telefono: telefono || '',
            cargo: 'Cliente',
        };
        const nuevosContactos = [...contactosActuales, nuevoContacto];

        await supabaseAdmin
            .from('empresas')
            .update({ contactos: nuevosContactos })
            .eq('id', empresa_id);
    }

    res.status(201).json({
        id: authData.user.id,
        email: authData.user.email,
        nombre,
        rol,
        activo: true,
        empresa_id: empresa_id || null,
    });
});

router.put('/:id', authGuard, adminGuard, async (req, res) => {
    const { activo, empresa_id, password, telefono, email } = req.body;
    const nombre = sanitize(req.body.nombre, 100);
    const rol    = ROLES_VALIDOS.includes(req.body.rol) ? req.body.rol : undefined;

    // Obtener datos actuales antes de actualizar (para detectar cambio de empresa)
    const { data: perfilActual } = await supabaseAdmin
        .from('profiles').select('empresa_id, nombre').eq('id', req.params.id).single();

    const updates = {};
    if (nombre     != null)       updates.nombre     = nombre;
    if (rol        !== undefined)  updates.rol        = rol;
    if (activo     !== undefined)  updates.activo     = activo;
    if (empresa_id !== undefined)  updates.empresa_id = empresa_id || null;

    const { data, error } = await supabaseAdmin
        .from('profiles').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    // Si se cambió la contraseña o el email
    const authUpdates = {};
    if (password?.trim()) authUpdates.password = password.trim();
    if (email?.trim())    authUpdates.email    = email.trim();
    if (Object.keys(authUpdates).length > 0) {
        await supabaseAdmin.auth.admin.updateUserById(req.params.id, authUpdates);
    }

    // Si cambió la empresa, mover el contacto de la empresa antigua a la nueva
    const nuevaEmpresaId = empresa_id !== undefined ? (empresa_id || null) : data.empresa_id;
    const viejaEmpresaId = perfilActual?.empresa_id || null;
    const empresaCambio  = empresa_id !== undefined && nuevaEmpresaId !== viejaEmpresaId;

    if (empresaCambio || telefono !== undefined) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.params.id);
        const userEmail = authUser?.user?.email;

        if (userEmail) {
            const nombreContacto = nombre ?? perfilActual?.nombre;

            // Eliminar de la empresa antigua
            if (empresaCambio && viejaEmpresaId) {
                const { data: viejaEmpresa } = await supabaseAdmin
                    .from('empresas').select('contactos').eq('id', viejaEmpresaId).single();
                if (viejaEmpresa?.contactos) {
                    const contactosFiltrados = viejaEmpresa.contactos.filter(
                        c => c.email?.toLowerCase() !== userEmail.toLowerCase()
                    );
                    await supabaseAdmin.from('empresas').update({ contactos: contactosFiltrados }).eq('id', viejaEmpresaId);
                }
            }

            // Añadir o actualizar en la empresa nueva
            if (nuevaEmpresaId) {
                const { data: nuevaEmpresa } = await supabaseAdmin
                    .from('empresas').select('contactos').eq('id', nuevaEmpresaId).single();
                const contactosActuales = nuevaEmpresa?.contactos || [];
                const idx = contactosActuales.findIndex(c => c.email?.toLowerCase() === userEmail.toLowerCase());
                if (idx >= 0) {
                    // Ya existe: actualizar nombre y teléfono si se proporcionaron
                    contactosActuales[idx] = {
                        ...contactosActuales[idx],
                        nombre: nombreContacto || contactosActuales[idx].nombre,
                        ...(telefono !== undefined ? { telefono: telefono || '' } : {}),
                    };
                } else {
                    // No existe: añadir
                    contactosActuales.push({
                        nombre: nombreContacto || '',
                        email:  userEmail,
                        telefono: telefono !== undefined ? (telefono || '') : '',
                    });
                }
                await supabaseAdmin.from('empresas').update({ contactos: contactosActuales }).eq('id', nuevaEmpresaId);
            }
        }
    }

    res.json(data);
});

router.delete('/:id', authGuard, adminGuard, async (req, res) => {
    if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
    }

    // Obtener datos del usuario antes de eliminarlo
    const { data: profile } = await supabaseAdmin
        .from('profiles').select('nombre, empresa_id').eq('id', req.params.id).single();
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(req.params.id);
    const userEmail = authUser?.user?.email?.toLowerCase();

    // Eliminar contacto de la empresa si tiene una asignada
    if (profile?.empresa_id && userEmail) {
        const { data: empresa } = await supabaseAdmin
            .from('empresas').select('contactos').eq('id', profile.empresa_id).single();
        if (empresa?.contactos) {
            const contacto = empresa.contactos.find(c => c.email?.toLowerCase() === userEmail)
                          || empresa.contactos.find(c => c.nombre?.trim().toLowerCase() === profile.nombre?.trim().toLowerCase());
            if (contacto) {
                const nuevosContactos = empresa.contactos.filter(c => c !== contacto);
                await supabaseAdmin.from('empresas').update({ contactos: nuevosContactos }).eq('id', profile.empresa_id);

                // Limpiar contacto_nombre en tickets abiertos que lo tenían asignado
                const contactoNombre = contacto.nombre;
                if (contactoNombre) {
                    const { data: ticketsConContacto } = await supabaseAdmin
                        .from('tickets_v2')
                        .select('id, estado')
                        .eq('empresa_id', profile.empresa_id)
                        .eq('contacto_nombre', contactoNombre)
                        .in('estado', ['Pendiente', 'En curso']);
                    if (ticketsConContacto?.length) {
                        await supabaseAdmin
                            .from('tickets_v2')
                            .update({ contacto_nombre: null, telefono_cliente: null })
                            .eq('empresa_id', profile.empresa_id)
                            .eq('contacto_nombre', contactoNombre)
                            .in('estado', ['Pendiente', 'En curso']);
                    }
                }
            }
        }
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

module.exports = router;
