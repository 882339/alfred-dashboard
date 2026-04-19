const express = require('express');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs');
const path = require('path');
const execPromise = util.promisify(exec);

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const EVENTS_FILE = path.join(__dirname, 'events.json');
const GOG_ACCOUNT = 'openclaw.bot.alessandro@gmail.com';

// Carica eventi locali
function loadLocalEvents() {
    try {
        if (fs.existsSync(EVENTS_FILE)) {
            return JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
        }
    } catch (e) { console.error('Error loading events:', e); }
    return [];
}

// Salva eventi locali
function saveLocalEvents(events) {
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

// Helper per eseguire comandi gog
async function gog(args) {
    try {
        const cmd = `GOG_ACCOUNT=${GOG_ACCOUNT} gog ${args} --json --no-input`;
        const { stdout } = await execPromise(cmd);
        return JSON.parse(stdout);
    } catch (err) {
        console.error('GOG Error:', err.message);
        throw err;
    }
}

// Verifica se Google è connesso
async function checkGoogleAuth() {
    try {
        await gog('calendar events "primary" --from 2026-01-01 --to 2026-01-02');
        return true;
    } catch {
        return false;
    }
}

// GET /api/status - Stato connessione
app.get('/api/status', async (req, res) => {
    const googleConnected = await checkGoogleAuth();
    const localEvents = loadLocalEvents();
    res.json({ googleConnected, localEventsCount: localEvents.length });
});

// GET /api/events - Lista eventi (locale + Google)
app.get('/api/events', async (req, res) => {
    const from = req.query.from || new Date().toISOString();
    const to = req.query.to || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    let allEvents = [];
    
    // Carica eventi locali
    const localEvents = loadLocalEvents();
    allEvents = [...localEvents];
    
    // Prova Google Calendar
    try {
        const googleEvents = await gog(`calendar events "primary" --from ${from} --to ${to}`);
        if (Array.isArray(googleEvents)) {
            allEvents = [...allEvents, ...googleEvents.map(e => ({...e, source: 'google'}))];
        }
    } catch (err) {
        console.log('Google Calendar non disponibile, uso solo eventi locali');
    }
    
    res.json(allEvents);
});

// POST /api/events - Crea evento
app.post('/api/events', async (req, res) => {
    try {
        const { title, description, start, end, color, emails, local } = req.body;
        
        // Se specificato local o Google non disponibile, salva localmente
        const googleConnected = await checkGoogleAuth();
        
        if (!googleConnected || local) {
            // Salva in locale
            const localEvents = loadLocalEvents();
            const newEvent = {
                id: 'local_' + Date.now(),
                summary: title,
                description,
                start: { dateTime: start },
                end: { dateTime: end },
                colorId: color,
                source: 'local',
                attendees: emails ? emails.map(e => ({ email: e })) : []
            };
            localEvents.push(newEvent);
            saveLocalEvents(localEvents);
            res.json(newEvent);
        } else {
            // Salva su Google Calendar
            let args = `calendar create "primary" --summary "${title}" --from ${start} --to ${end}`;
            if (description) args += ` --description "${description}"`;
            if (color) args += ` --event-color ${color}`;
            
            const result = await gog(args);
            res.json(result);
        }
    } catch (err) {
        console.error('Error:', err.message);
        // Fallback a locale
        const localEvents = loadLocalEvents();
        const newEvent = {
            id: 'local_' + Date.now(),
            summary: req.body.title,
            start: { dateTime: req.body.start },
            end: { dateTime: req.body.end },
            source: 'local'
        };
        localEvents.push(newEvent);
        saveLocalEvents(localEvents);
        res.json(newEvent);
    }
});

// DELETE /api/events/:id - Elimina evento
app.delete('/api/events/:id', async (req, res) => {
    try {
        const id = req.params.id;
        
        if (id.startsWith('local_')) {
            // Elimina da locale
            let localEvents = loadLocalEvents();
            localEvents = localEvents.filter(e => e.id !== id);
            saveLocalEvents(localEvents);
        } else {
            // Elimina da Google
            await gog(`calendar delete "primary" ${id}`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/send-reminder - Invia email promemoria
app.post('/api/send-reminder', async (req, res) => {
    try {
        const { to, eventTitle, eventDate, eventTime, location, description } = req.body;
        
        const htmlBody = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0f; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: linear-gradient(145deg, #1a1a24 0%, #12121a 100%); border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
                    <tr>
                        <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 30px; text-align: center;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center" style="font-size: 48px;">📅</td>
                                </tr>
                                <tr>
                                    <td align="center" style="color: white; font-size: 24px; font-weight: 700; padding-top: 10px;">
                                        Promemoria Evento
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="padding-bottom: 20px; border-bottom: 1px solid #2a2a3a;">
                                        <span style="color: #6366f1; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Titolo Evento</span>
                                        <p style="color: #f8fafc; font-size: 22px; font-weight: 600; margin: 8px 0 0 0;">${eventTitle}</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 20px 0; border-bottom: 1px solid #2a2a3a;">
                                        <table width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td valign="top" style="padding-right: 20px;">
                                                    <span style="color: #6366f1; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">📅 Data</span>
                                                    <p style="color: #f8fafc; font-size: 16px; margin: 8px 0 0 0;">${eventDate}</p>
                                                </td>
                                                <td valign="top">
                                                    <span style="color: #6366f1; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">⏰ Orario</span>
                                                    <p style="color: #f8fafc; font-size: 16px; margin: 8px 0 0 0;">${eventTime}</p>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                ${location ? `
                                <tr>
                                    <td style="padding: 20px 0; border-bottom: 1px solid #2a2a3a;">
                                        <span style="color: #6366f1; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">📍 Luogo</span>
                                        <p style="color: #f8fafc; font-size: 16px; margin: 8px 0 0 0;">${location}</p>
                                    </td>
                                </tr>
                                ` : ''}
                                ${description ? `
                                <tr>
                                    <td style="padding: 20px 0;">
                                        <span style="color: #6366f1; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">📝 Note</span>
                                        <p style="color: #94a3b8; font-size: 15px; margin: 8px 0 0 0; line-height: 1.6;">${description}</p>
                                    </td>
                                </tr>
                                ` : ''}
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: #0d0d14; padding: 20px; text-align: center;">
                            <p style="color: #64748b; font-size: 13px; margin: 0;">
                                Gestito da <strong style="color: #8b5cf6;">Alfred</strong> 🤖
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

        const args = `gmail send --to "${to}" --subject "📅 Promemoria: ${eventTitle}" --body-html '${htmlBody.replace(/'/g, "\\'")}'`;
        
        await gog(args);
        res.json({ success: true });
    } catch (err) {
        console.error('Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/colors - Colori calendario
app.get('/api/colors', async (req, res) => {
    try {
        const result = await gog('calendar colors');
        res.json(result);
    } catch (err) {
        res.json([
            { id: 1, color: '#a4bdfc' },
            { id: 2, color: '#7ae7bf' },
            { id: 3, color: '#dbadff' },
            { id: 4, color: '#ff887c' },
            { id: 5, color: '#fbd75b' },
            { id: 6, color: '#ffb878' },
            { id: 7, color: '#46d6db' },
            { id: 8, color: '#e1e1e1' },
            { id: 9, color: '#5484ed' },
            { id: 10, color: '#51b749' },
            { id: 11, color: '#dc2127' }
        ]);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});