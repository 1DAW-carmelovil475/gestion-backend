const nodemailer = require('nodemailer');
const supabaseAdmin = require('../supabase');

const emailTransporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   parseInt(process.env.EMAIL_PORT || '465'),
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

// Obtiene perfiles con email cruzando profiles + auth.users
async function getPerfilesConEmail(ids) {
    if (!ids?.length) return [];

    const { data: perfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre, rol')
        .in('id', ids);

    if (!perfiles?.length) return [];

    const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = {};
    authData?.users?.forEach(u => { emailMap[u.id] = u.email; });

    return perfiles.map(p => ({ ...p, email: emailMap[p.id] || null }));
}

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
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e0e0e0;">

        <!-- HEADER -->
        <tr>
          <td style="background:#0047b3;padding:24px 32px;">
            <p style="margin:0 0 4px;color:#a8c4f0;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Sistema de Tickets</p>
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">Hola Informatica</p>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 6px;color:#333333;font-size:15px;">Hola, <strong>${operario.nombre || operario.email}</strong></p>
            <p style="margin:0 0 24px;color:#555555;font-size:14px;line-height:1.6;">Se te ha asignado el ticket <strong>#${ticket.numero}</strong>. A continuacion tienes los detalles.</p>

            <!-- ASUNTO -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td style="background:#f0f4ff;border-left:3px solid #0047b3;padding:14px 16px;">
                  <p style="margin:0 0 3px;color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Asunto</p>
                  <p style="margin:0;color:#111111;font-size:16px;font-weight:bold;">${ticket.asunto}</p>
                </td>
              </tr>
            </table>

            <!-- DATOS -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;margin-bottom:24px;">
              <tr>
                <td width="50%" style="padding:12px 16px;border-bottom:1px solid #e0e0e0;border-right:1px solid #e0e0e0;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Empresa</p>
                  <p style="margin:0;color:#222222;font-size:14px;font-weight:bold;">${empresa || '—'}</p>
                </td>
                <td width="50%" style="padding:12px 16px;border-bottom:1px solid #e0e0e0;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Prioridad</p>
                  <p style="margin:0;color:#ffffff;font-size:13px;font-weight:bold;display:inline-block;background:${prioridadColor};padding:2px 10px;">${ticket.prioridad}</p>
                </td>
              </tr>
              <tr>
                <td width="50%" style="padding:12px 16px;border-right:1px solid #e0e0e0;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Estado</p>
                  <p style="margin:0;color:#222222;font-size:14px;">${ticket.estado}</p>
                </td>
                <td width="50%" style="padding:12px 16px;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Fecha</p>
                  <p style="margin:0;color:#222222;font-size:14px;">${new Date(ticket.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                </td>
              </tr>
            </table>

            ${ticket.descripcion ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#fafafa;border:1px solid #e0e0e0;padding:14px 16px;">
                  <p style="margin:0 0 4px;color:#888888;font-size:11px;text-transform:uppercase;">Descripcion</p>
                  <p style="margin:0;color:#444444;font-size:14px;line-height:1.6;">${ticket.descripcion}</p>
                </td>
              </tr>
            </table>` : ''}

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="padding:8px 0;">
                  <a href="${ticketUrl}" style="display:inline-block;background:#0047b3;color:#ffffff;text-decoration:none;padding:13px 36px;font-size:14px;font-weight:bold;">
                    Ver ticket #${ticket.numero}
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f4f4f4;border-top:1px solid #e0e0e0;padding:16px 32px;">
            <p style="margin:0;color:#999999;font-size:12px;text-align:center;line-height:1.6;">
              Este correo se ha generado automaticamente. No respondas a este mensaje.<br>
              &copy; ${new Date().getFullYear()} Hola Informatica
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
        subject: `Ticket #${ticket.numero} asignado: ${ticket.asunto}`,
        html,
    });
}

module.exports = { getPerfilesConEmail, enviarEmailAsignacion };