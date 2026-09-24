/**
 * Placement Tracker '27 — Gmail → Supabase inbox
 *
 * SETUP (once):
 *  1. script.google.com → New project → name it "Placement Tracker sync".
 *  2. Delete the sample code, paste this whole file, Save.
 *  3. Project Settings (gear) → Script Properties → Add these four:
 *       SUPABASE_URL       https://ijleqdvbynxgcdwahrhx.supabase.co
 *       SUPABASE_ANON_KEY  sb_publishable__dDzZdVFtKeogc1TKg1y7Q_v3DN009j
 *       TRACKER_EMAIL      <the email you sign in to the tracker with>
 *       TRACKER_PASSWORD   <that password>
 *  4. Back in the editor: choose the function `runOnce` → Run.
 *     Google asks for Gmail permission the first time — allow it.
 *     Check the log: it says how many emails were queued.
 *  5. Choose `installTrigger` → Run.  That schedules it every 15 minutes.
 *
 * It only ever READS Gmail. It never replies, deletes, or marks anything read.
 */

// Only mails received at or after this moment are considered.
var CUTOFF = "2026-09-24T12:53:00+05:30";
var SENDERS = ["pesuplacements@pes.edu", "placementsupport@pes.edu"];

// ---------------------------------------------------------------- entry points
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "syncPlacementEmails") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("syncPlacementEmails").timeBased().everyMinutes(15).create();
  Logger.log("Trigger installed — runs every 15 minutes.");
}
function runOnce() { syncPlacementEmails(); }

function syncPlacementEmails() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SUPABASE_URL"),
      key = props.getProperty("SUPABASE_ANON_KEY"),
      email = props.getProperty("TRACKER_EMAIL"),
      pass = props.getProperty("TRACKER_PASSWORD");
  if (!url || !key || !email || !pass) { Logger.log("Missing Script Properties — see the setup notes at the top."); return; }

  var auth = signIn(url, key, email, pass);
  if (!auth) { Logger.log("Could not sign in to Supabase — check TRACKER_EMAIL / TRACKER_PASSWORD."); return; }

  var cutoffMs = new Date(CUTOFF).getTime();
  var seen = JSON.parse(props.getProperty("SEEN_IDS") || "[]");
  var seenSet = {}; seen.forEach(function (id) { seenSet[id] = 1; });

  var since = Utilities.formatDate(new Date(cutoffMs - 864e5), "GMT+5:30", "yyyy/MM/dd");
  var query = "is:unread after:" + since + " (" + SENDERS.map(function (s) { return "from:" + s; }).join(" OR ") + ")";

  var queued = 0, skipped = 0;
  GmailApp.search(query, 0, 50).forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var id = msg.getId();
      if (seenSet[id]) { skipped++; return; }
      if (msg.getDate().getTime() < cutoffMs) { skipped++; return; }
      if (!fromWatchedSender(msg.getFrom())) { skipped++; return; }

      if (!isPlacementMail(msg.getSubject(), msg.getPlainBody())) {
        skipped++; seen.push(id); seenSet[id] = 1;      // remember it so we don't re-check every run
        return;
      }

      var parsed = parsePlacementEmail(msg.getSubject(), msg.getPlainBody(), msg.getDate().toISOString());
      parsed.gmailId = id;
      parsed.from = msg.getFrom();
      parsed.permalink = "https://mail.google.com/mail/u/0/#inbox/" + thread.getId();
      parsed.raw = msg.getPlainBody().slice(0, 4000);

      if (upsertInbox(url, key, auth.token, auth.userId, id, parsed)) {
        queued++; seen.push(id); seenSet[id] = 1;
      }
    });
  });

  props.setProperty("SEEN_IDS", JSON.stringify(seen.slice(-500)));
  Logger.log("Queued " + queued + " email(s); skipped " + skipped + ".");
}

function fromWatchedSender(from) {
  var f = String(from).toLowerCase();
  return SENDERS.some(function (s) { return f.indexOf(s) !== -1; });
}

// ---------------------------------------------------------------- supabase
function signIn(url, key, email, pass) {
  var res = UrlFetchApp.fetch(url + "/auth/v1/token?grant_type=password", {
    method: "post", contentType: "application/json",
    headers: { apikey: key },
    payload: JSON.stringify({ email: email, password: pass }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) { Logger.log("Sign-in failed: " + res.getContentText()); return null; }
  var b = JSON.parse(res.getContentText());
  return { token: b.access_token, userId: b.user.id };
}

function upsertInbox(url, key, token, userId, id, data) {
  var res = UrlFetchApp.fetch(url + "/rest/v1/inbox?on_conflict=id", {
    method: "post", contentType: "application/json",
    headers: { apikey: key, Authorization: "Bearer " + token, Prefer: "resolution=ignore-duplicates" },
    payload: JSON.stringify([{ id: id, user_id: userId, data: data }]),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) { Logger.log("Insert failed: " + res.getContentText()); return false; }
  return true;
}

// ---------------------------------------------------------------- relevance
/**
 * True only for mails that are actually about a recruitment drive.
 * The placement group also forwards education fairs, webinars, fee notices
 * and general announcements — those should never reach the tracker.
 */
function isPlacementMail(subject, body) {
  var T = (String(subject||"") + "\n" + String(body||"")).toLowerCase();

  // things that are definitely not a drive, however they are worded
  if (/education fair|virtual fair|study abroad|globaldegrees|gre\b|ielts|toefl|ms in |admission|scholarship|alumni meet|convocation|fee (payment|structure)|hostel|time ?table|exam schedule|survey|feedback form|newsletter/.test(T)
      && !/recruitment drive|ctc|lpa|stipend/.test(T)) return false;
  if (/^\s*(fwd:|fw:|re:)*\s*invitation\b/i.test(String(subject||"")) && !/recruitment drive|ctc|lpa|stipend|shortlist/.test(T)) return false;

  var strong = /recruitment drive|placement drive|placement opportunity|^role:|\nrole:|\nctc:|application deadline|shortlist(ed)?\b|online assessment|offer letter|job description/m.test(T)
            || /(?:₹|rs\.?|inr)\s*[\d,]{4,}/.test(T)
            || /[\d.]+\s*(?:lpa|lakhs? per annum)/.test(T);
  var medium = 0;
  if (/hiring|recruit|drive\b|intern(ship)?\b|full[- ]?time|fte\b|ppo\b/.test(T)) medium++;
  if (/cgpa|backlog|eligib/.test(T)) medium++;
  if (/interview|aptitude|technical round|hr round|group discussion/.test(T)) medium++;
  if (/register|apply\b|deadline/.test(T)) medium++;

  return strong || medium >= 3;
}

// ---------------------------------------------------------------- parser
// The tracker only displays what this produces; all extraction happens here.
function parsePlacementEmail(subject, body, receivedISO) {
  var S = String(subject || "").replace(/^\s*(?:(?:fwd?|re|fw)\s*:\s*)+/i, "");   // drop Fwd:/Re: prefixes
  var B = String(body || "").replace(/\r/g, "");
  var JUNK_CO = /^(fwd?|re|invitation|dear|all|hi|hello|urgent|important|reminder|update|notice|attention)$/i;
  var year0 = new Date(receivedISO || Date.now()).getFullYear();
  var lines0;
  var out = { company:"", roles:[], tier:"", location:"", branches:"", gpa:"", deadline:"", deadlineTime:"",
              rounds:[], reminders:[], link:"", notes:[], confidence:"partial", subject:S, receivedAt:receivedISO||"" };

  function line(re) { var m = B.match(re); return m ? m[1].trim() : ""; }
  function money(s) { var m = String(s).replace(/[, ]/g,"").match(/₹?([\d.]+)/); return m ? parseFloat(m[1]) : null; }
  var MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
  function toISO(d, monName, y) {
    var k = String(monName).toLowerCase().replace(/[^a-z]/g,"");
    var mo = MONTHS[k.slice(0,4)]; if (mo === undefined) mo = MONTHS[k.slice(0,3)];
    if (mo === undefined || !d) return "";
    var yy = y || year0;
    return yy + "-" + pad(mo+1) + "-" + pad(d);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function findDate(str) {
    if (!str) return "";
    var m = String(str).match(/(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s*(\d{4})?/);
    return m ? toISO(m[1], m[2], m[3] ? +m[3] : null) : "";
  }
  function findTime(str) {
    var m = String(str).match(/(\d{1,2})[:.](\d{2})\s*(am|pm|AM|PM)?/);
    if (!m) return "";
    var h = +m[1], mi = m[2], ap = (m[3]||"").toLowerCase();
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    return pad(h) + ":" + mi;
  }

  var co = line(/Upcoming Placement Opportunity:\s*(.+?)\s*[—\-–]\s*Check Details/i);
  if (!co) { var m1 = S.match(/Upcoming Placement Opportunity:\s*(.+?)\s*[—\-–]\s*Check Details/i); if (m1) co = m1[1]; }
  if (!co) { var m2 = S.match(/^\s*([^|:–—]+?)\s*\|/); if (m2) co = m2[1]; }
  if (!co) { var m3 = B.match(/inform you that\s+(.+?)\s+is organi[sz]ing/i); if (m3) co = m3[1]; }
  if (!co) { var m4 = S.match(/^\s*([A-Z][\w.&' ]{2,40}?)\s*[-–—:]/); if (m4) co = m4[1]; }
  co = (co || "").replace(/\s+/g," ").trim();
  if (JUNK_CO.test(co) || co.length < 2) co = "";
  out.company = co;

  var evt      = line(/^Event:\s*(.+)$/mi);
  var dateLn   = line(/^Date:\s*(.+)$/mi);
  var roundsLn = line(/^Rounds?:\s*(.+)$/mi);
  var dlLn     = line(/Application Deadline:\s*(.+)$/mi);
  var roleLn   = line(/^Role:\s*(.+)$/mi);
  var locLn    = line(/^Location:\s*(.+)$/mi);
  var stipLn   = line(/^Stipend:\s*(.+)$/mi);
  var ctcLn    = line(/^CTC:\s*(.+)$/mi);
  var deptLn   = line(/^B\.?Tech:\s*(.+)$/mi) || line(/^Departments?:\s*(.+)$/mi);
  var eligLn   = line(/(10th:.*Backlogs?:.*)$/mi);
  var isTemplate = !!(evt || (roleLn && ctcLn));

  var jobType = "";
  var drive = B.match(/organi[sz]ing an?\s+(.+?)\s+recruitment drive/i);
  var kind = (drive ? drive[1] : (S + " " + B.slice(0,400))).toLowerCase();
  var hasIntern = /intern/.test(kind), hasFte = /full[- ]?time|fte|employment/.test(kind);
  if (hasIntern && hasFte) jobType = "Intern + FTE";
  else if (/ppo/.test(kind)) jobType = "PPO";
  else if (hasIntern) jobType = "Intern";
  else if (hasFte) jobType = "FTE";

  var stipend = null, ctc = null;
  if (stipLn) stipend = money(stipLn);
  if (ctcLn) { var v = money(ctcLn); ctc = /lpa|lakh/i.test(ctcLn) ? v : (v > 1000 ? v/100000 : v); }
  if (stipend === null) {
    var ms = B.match(/(?:monthly\s+)?stipend[^\n:]*:?\s*(?:INR|₹|Rs\.?)?\s*([\d,]{4,})/i);
    if (ms) stipend = money(ms[1]);
  }
  if (ctc === null) {
    var mc = B.match(/(?:CTC|package)[^\n]{0,20}?(?:₹|Rs\.?|INR)?\s*([\d.]+)\s*(?:LPA|lakhs?|L\b)/i);
    if (mc) ctc = parseFloat(mc[1]);
  }

  var title = roleLn || "";
  if (!title && evt) { var parts = evt.split("|"); if (parts.length >= 2) title = parts[1].trim(); }
  if (!title) {
    var mt = S.match(/\|\s*(.+?)\s*(?:\(|$)/);
    if (mt) title = mt[1].replace(/\bPESU\b|\bPES\b/gi,"")
                         .replace(/\b(hiring|recruitment|drive|opportunity|process)\b/gi,"")
                         .replace(/\s{2,}/g," ").trim();
  }
  if (!title) { var mr = B.match(/for the below\s+(\w+)\s+Role/i); if (mr) title = mr[1] + " Role"; }

  var gpa = "";
  if (eligLn) { var mg = eligLn.match(/UG\s*CGPA:\s*([\d.]+)/i); if (mg) gpa = mg[1]; }
  if (!gpa) { var mg2 = B.match(/CGPA\s*(?:above|of|:|≥|>=)\s*([\d.]+)/i); if (mg2) gpa = mg2[1]; }
  out.gpa = gpa;
  out.roles.push({ title:(title||"").replace(/\s+/g," ").trim(), jobType:jobType,
                   stipend:stipend, base:null, ctc:ctc, gpa:gpa, applied:false });

  if (eligLn) out.notes.push("Eligibility — " + eligLn.replace(/\s*\|\s*/g, " | "));
  else if (/no\s+backlog/i.test(B)) out.notes.push("Eligibility — no backlogs");
  var housing = B.match(/housing stipend[^\n:]*:?\s*(?:INR|₹|Rs\.?)?\s*([\d,]{4,})/i);
  if (housing) out.notes.push("Housing stipend: ₹" + housing[1] + "/month");

  if (deptLn) out.branches = deptLn.replace(/B\.?Tech:?\s*/i,"").replace(/\s*,\s*/g,", ").trim();
  if (!out.branches) { var mb = B.match(/\b(CSE(?:\s*,\s*(?:AIML|ECE|EEE|MECH|BT))*)\b/); if (mb) out.branches = mb[1]; }

  out.location = (locLn || "").replace(/[,\s]+$/,"");
  if (!out.location) { var ml = B.match(/based out of\s+([A-Za-z ]+)/i); if (ml) out.location = ml[1].trim(); }

  if (dlLn) { out.deadline = findDate(dlLn); out.deadlineTime = findTime(dlLn); }
  if (!out.deadline) {
    var md = B.match(/(?:register|apply|submit|respond|confirm)[^\n]{0,80}?\b(?:by|before|latest by)\s+([^\n]{3,50})/i);
    if (md) {
      var frag = md[1];
      out.deadline = findDate(frag) ||
        (/\btoday\b/i.test(frag) ? String(receivedISO||"").slice(0,10) :
         /\btomorrow\b/i.test(frag) ? new Date(new Date(receivedISO||Date.now()).getTime()+864e5).toISOString().slice(0,10) : "");
      out.deadlineTime = findTime(frag);
    }
  }

  var driveDate = findDate(dateLn), driveTime = findTime(dateLn);
  if (roundsLn) {
    roundsLn.split(/\s*,\s*/).forEach(function (n, i) {
      if (!n) return;
      out.rounds.push({ type: mapRound(n), otherType: mapRound(n)==="Other" ? n : "",
                        date: i===0 ? driveDate : "", time: i===0 ? driveTime : "", result:"pending", note:"" });
    });
  }
  var tl = B.match(/^\s*(\d{1,2}[^\n:]{0,40}):\s*([A-Za-z][^\n]{3,40})$/gm) || [];
  tl.forEach(function (l) {
    var m = l.match(/^\s*(\d{1,2}[^\n:]{0,40}):\s*(.+)$/);
    if (!m) return;
    var d = findDate(m[1]); if (!d) return;
    out.rounds.push({ type: mapRound(m[2]), otherType: mapRound(m[2])==="Other" ? m[2].trim() : "",
                      date: d, time:"", result:"pending", note: m[1].trim() });
  });
  if (!out.rounds.length && driveDate)
    out.rounds.push({ type:"Other", otherType:"Drive", date:driveDate, time:driveTime, result:"pending", note:"" });

  // Schedule emails state rounds the other way round:
  // "Online Assessment: 28th September 2026, 10:00 AM" / "Technical Interview on 3rd October".
  lines0 = B.split("\n");
  for (var li = 0; li < lines0.length; li++) {
    var lm = lines0[li].match(/^\s*([A-Za-z][A-Za-z /&+-]{2,40}?)\s*(?::|—|\bon\b|\bis scheduled (?:on|for)\b)\s*(.*\d.*)$/);
    if (!lm) continue;
    var rtype = mapRound(lm[1]);
    if (rtype === "Other") continue;                       // only named rounds, never "Venue:" or "CTC:"
    var rd = findDate(lm[2]); if (!rd) continue;
    var rt = findTime(lm[2]);
    var existing = null;
    for (var ri = 0; ri < out.rounds.length; ri++)
      if (out.rounds[ri].type === rtype && (!out.rounds[ri].date || out.rounds[ri].date === rd)) { existing = out.rounds[ri]; break; }
    if (existing) { existing.date = existing.date || rd; existing.time = existing.time || rt; }
    else out.rounds.push({ type: rtype, otherType: "", date: rd, time: rt, result: "pending", note: "" });
  }

  // A round often has its own date stated somewhere in the body
  // ("Online Assessment: 25 Sept", "Technical Interview on 2 October, 10:00 AM").
  var ROUND_WORDS = {
    "OA": /online assessment|online test|coding test|\boa\b|aptitude/i,
    "Aptitude": /aptitude/i,
    "Group discussion": /group discussion|\bgd\b/i,
    "Application": /resume screening|shortlist|registration/i,
    "Technical R1": /technical (interview|round)|tech round|interview/i,
    "Technical R2": /technical round 2|second (technical )?round|round 2/i,
    "Managerial": /managerial/i,
    "HR": /\bhr\b/i,
    "PPT": /pre[- ]?placement talk|presentation|\bppt\b/i,
    "Offer": /offer (release|letter)|final result/i
  };
  var lines = lines0;
  out.rounds.forEach(function (r) {
    if (r.date) return;
    var words = ROUND_WORDS[r.type]; if (!words) return;
    for (var i = 0; i < lines.length; i++) {
      if (!words.test(lines[i])) continue;
      var d = findDate(lines[i]);
      if (d) { r.date = d; r.time = r.time || findTime(lines[i]); break; }
    }
  });

  // ---------------------------------------------------------------- reminders
  function addReminder(date, text) {
    if (!date) return;
    if (out.reminders.some(function (x) { return x.date === date && x.text === text; })) return;
    out.reminders.push({ date: date, text: text, done: false });
  }
  function dayBefore(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  var gotDate = String(receivedISO || "").slice(0, 10);

  if (out.deadline) {
    addReminder(out.deadline, "Last day to apply" + (out.deadlineTime ? " — by " + out.deadlineTime : ""));
    var pre = dayBefore(out.deadline);
    if (pre > gotDate) addReminder(pre, "Application deadline is tomorrow");
  }
  out.rounds.forEach(function (r) {
    if (!r.date) return;
    var label = (r.type === "Other" && r.otherType) ? r.otherType : r.type;
    addReminder(r.date, label + " today" + (r.time ? " at " + r.time : ""));
    var pre = dayBefore(r.date);
    if (/Technical|Managerial|HR|Group discussion|OA|Aptitude/.test(r.type) && pre > gotDate)
      addReminder(pre, label + " tomorrow" + (r.time ? " at " + r.time : "") + " — prep");
  });
  out.reminders.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });

  var link = B.match(/https?:\/\/\S*(?:forms\.gle|docs\.google\.com\/forms|unstop|superset|hirepro)\S*/i)
          || B.match(/https?:\/\/\S{10,}/);
  if (link) out.link = link[0].replace(/[)\],.]+$/,"");

  if (ctc != null) out.tier = ctc >= 12 ? "Tier 1" : ctc >= 6 ? "Tier 2" : ctc >= 3 ? "Tier 3" : "";
  else if (stipend != null) out.tier = "Internship Only";

  out.confidence = (isTemplate && out.company && out.roles[0].title && (ctc!=null||stipend!=null)) ? "high" : "partial";
  return out;
}

function mapRound(name) {
  var n = String(name).toLowerCase();
  if (/online assessment|\boa\b|online test|coding test|assessment/.test(n)) return "OA";
  if (/aptitude/.test(n)) return "Aptitude";
  if (/group discussion|\bgd\b/.test(n)) return "Group discussion";
  if (/resume|shortlist|screening/.test(n)) return "Application";
  if (/managerial/.test(n)) return "Managerial";
  if (/\bhr\b/.test(n)) return "HR";
  if (/technical|tech\b|interview/.test(n)) return "Technical R1";
  if (/ppt|presentation|pre[- ]?placement talk/.test(n)) return "PPT";
  if (/offer|result/.test(n)) return "Offer";
  return "Other";
}
