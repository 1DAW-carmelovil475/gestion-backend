// ============================================
// EMAILS DEL CALENDARIO — Asignación y recordatorios
// ============================================

const nodemailer = require('nodemailer');

const emailTransporter = nodemailer.createTransport({
    host:   process.env.EMAIL_HOST,
    port:   parseInt(process.env.EMAIL_PORT || '465'),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

function formatFecha(fechaStr) {
    return new Date(fechaStr).toLocaleDateString('es-ES', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function formatMinutos(min) {
    if (min < 60) return `${min} minutos`;
    if (min === 60) return '1 hora';
    if (min < 1440) return `${Math.round(min / 60)} horas`;
    if (min === 1440) return '1 día';
    return `${Math.round(min / 1440)} días`;
}

const TIPO_LABEL = { evento: 'Evento', tarea: 'Tarea', nota: 'Nota' };

// ── Email de asignación de evento/tarea ──────────────────────────────────
async function enviarEmailEventoAsignado({ destinatario, evento, asignadoPor }) {
    if (!destinatario.email) return;

    const frontendUrl = process.env.FRONTEND_URL;
    const tipoLabel = TIPO_LABEL[evento.tipo] || 'Evento';

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
            <p style="margin:0 0 4px;color:#a8c4f0;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Calendario</p>
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">Hola Informatica</p>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 6px;color:#333333;font-size:15px;">Hola, <strong>${destinatario.nombre || destinatario.email}</strong></p>
            <p style="margin:0 0 24px;color:#555555;font-size:14px;line-height:1.6;">
              <strong>${asignadoPor}</strong> te ha asignado ${tipoLabel === 'Tarea' ? 'una tarea' : 'un evento'}:
            </p>

            <!-- TÍTULO -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td style="background:#f0f4ff;border-left:3px solid ${evento.color || '#0047b3'};padding:14px 16px;">
                  <p style="margin:0 0 3px;color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${tipoLabel}</p>
                  <p style="margin:0;color:#111111;font-size:16px;font-weight:bold;">${evento.titulo}</p>
                </td>
              </tr>
            </table>

            <!-- DATOS -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;margin-bottom:24px;">
              <tr>
                <td width="50%" style="padding:12px 16px;border-bottom:1px solid #e0e0e0;border-right:1px solid #e0e0e0;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Inicio</p>
                  <p style="margin:0;color:#222222;font-size:14px;">${formatFecha(evento.fecha_inicio)}</p>
                </td>
                <td width="50%" style="padding:12px 16px;border-bottom:1px solid #e0e0e0;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Fin</p>
                  <p style="margin:0;color:#222222;font-size:14px;">${formatFecha(evento.fecha_fin)}</p>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding:12px 16px;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Tipo</p>
                  <p style="margin:0;color:#222222;font-size:14px;font-weight:bold;">${tipoLabel}</p>
                </td>
              </tr>
            </table>

            ${evento.descripcion ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#fafafa;border:1px solid #e0e0e0;padding:14px 16px;">
                  <p style="margin:0 0 4px;color:#888888;font-size:11px;text-transform:uppercase;">Descripcion</p>
                  <p style="margin:0;color:#444444;font-size:14px;line-height:1.6;">${evento.descripcion}</p>
                </td>
              </tr>
            </table>` : ''}

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="padding:8px 0;">
                  <a href="${frontendUrl}/calendario" style="display:inline-block;background:#0047b3;color:#ffffff;text-decoration:none;padding:13px 36px;font-size:14px;font-weight:bold;">
                    Ver calendario
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
        to:      destinatario.email,
        subject: `${asignadoPor} te ha asignado ${tipoLabel === 'Tarea' ? 'una tarea' : 'un evento'}: ${evento.titulo}`,
        html,
    });
}

// ── Email de recordatorio ────────────────────────────────────────────────
async function enviarEmailRecordatorio({ destinatario, evento, minutosAntes }) {
    if (!destinatario.email) return;

    const frontendUrl = process.env.FRONTEND_URL;
    const tipoLabel = TIPO_LABEL[evento.tipo] || 'Evento';
    const tiempoTexto = formatMinutos(minutosAntes);

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
          <td style="background:#d97706;padding:24px 32px;">
            <p style="margin:0 0 4px;color:#fef3c7;font-size:11px;text-transform:uppercase;letter-spacing:1px;">Recordatorio</p>
            <p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">Hola Informatica</p>
          </td>
        </tr>

        <!-- CUERPO -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 6px;color:#333333;font-size:15px;">Hola, <strong>${destinatario.nombre || destinatario.email}</strong></p>
            <p style="margin:0 0 24px;color:#555555;font-size:14px;line-height:1.6;">
              Tienes ${tipoLabel === 'Tarea' ? 'una tarea' : 'un evento'} en <strong>${tiempoTexto}</strong>:
            </p>

            <!-- TÍTULO -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td style="background:#fef3c7;border-left:3px solid #d97706;padding:14px 16px;">
                  <p style="margin:0 0 3px;color:#666666;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">${tipoLabel}</p>
                  <p style="margin:0;color:#111111;font-size:16px;font-weight:bold;">${evento.titulo}</p>
                </td>
              </tr>
            </table>

            <!-- DATOS -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;margin-bottom:24px;">
              <tr>
                <td width="50%" style="padding:12px 16px;border-right:1px solid #e0e0e0;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Inicio</p>
                  <p style="margin:0;color:#222222;font-size:14px;font-weight:bold;">${formatFecha(evento.fecha_inicio)}</p>
                </td>
                <td width="50%" style="padding:12px 16px;vertical-align:top;">
                  <p style="margin:0 0 3px;color:#888888;font-size:11px;text-transform:uppercase;">Fin</p>
                  <p style="margin:0;color:#222222;font-size:14px;">${formatFecha(evento.fecha_fin)}</p>
                </td>
              </tr>
            </table>

            ${evento.descripcion ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#fafafa;border:1px solid #e0e0e0;padding:14px 16px;">
                  <p style="margin:0 0 4px;color:#888888;font-size:11px;text-transform:uppercase;">Descripcion</p>
                  <p style="margin:0;color:#444444;font-size:14px;line-height:1.6;">${evento.descripcion}</p>
                </td>
              </tr>
            </table>` : ''}

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="padding:8px 0;">
                  <a href="${frontendUrl}/calendario" style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;padding:13px 36px;font-size:14px;font-weight:bold;">
                    Ver calendario
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
        to:      destinatario.email,
        subject: `Recordatorio: ${evento.titulo} — en ${tiempoTexto}`,
        html,
    });
}

module.exports = { enviarEmailEventoAsignado, enviarEmailRecordatorio };
