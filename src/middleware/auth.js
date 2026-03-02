const supabaseAdmin = require('../supabase');

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

module.exports = { authGuard, adminGuard };