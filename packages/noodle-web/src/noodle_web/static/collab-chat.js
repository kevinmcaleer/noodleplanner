/**
 * collab-chat.js -- the planning-session chat's message list, shared by the
 * host (collab-session.js) and the joiner page (collab_join.html) so the two
 * render the same conversation the same way (#1347).
 *
 * Messages are chat bubbles: a profile chip beside each one, and the
 * sender's name and the time on one small line above the bubble. The
 * reader's own messages sit on the right in the accent colour. Session
 * activity ("Alex added task ...") is a quiet centred line rather than a
 * bubble, since nobody said it.
 *
 * A classic script exposing `NoodleCollabChat`, because collab-session.js is
 * one too and cannot import a module synchronously. Every string is set with
 * textContent: chat text comes from other participants and is never markup.
 */
(function (global) {
    'use strict';

    /** One or two capital letters for the profile chip. */
    function initials(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    }

    function formatTime(timestamp) {
        try {
            return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    }

    function isoTime(timestamp) {
        try { return new Date(timestamp).toISOString(); } catch { return ''; }
    }

    /** The reader's own message: one whose id is in `ownIds`, when the
     * reader knows which messages it sent, else one whose sender is
     * `selfName`. Ids are exact where a name is not -- two people can share
     * one, and the host's can change mid-session with their profile. */
    function isOwn(entry, options) {
        if (options.ownIds) return options.ownIds.has(String(entry.id));
        return !!options.selfName && String(entry.sender || '') === String(options.selfName);
    }

    function buildActivity(entry) {
        const row = document.createElement('div');
        row.className = 'np-chat-activity';
        const text = document.createElement('span');
        text.textContent = `${entry.sender} ${entry.text}`;
        const time = document.createElement('time');
        time.dateTime = isoTime(entry.timestamp);
        time.textContent = formatTime(entry.timestamp);
        row.append(text, time);
        return row;
    }

    function buildMessage(entry, options) {
        const own = isOwn(entry, options);
        const row = document.createElement('article');
        row.className = own ? 'np-chat-message is-own' : 'np-chat-message';
        row.dataset.entryId = entry.id;

        const chip = document.createElement('span');
        chip.className = 'np-chat-avatar';
        chip.textContent = initials(entry.sender);
        chip.title = entry.sender;
        chip.setAttribute('aria-hidden', 'true');

        const body = document.createElement('div');
        body.className = 'np-chat-body';

        const meta = document.createElement('div');
        meta.className = 'np-chat-meta';
        const name = document.createElement('span');
        name.className = 'np-chat-name';
        name.textContent = own ? 'You' : entry.sender;
        const time = document.createElement('time');
        time.className = 'np-chat-time';
        time.dateTime = isoTime(entry.timestamp);
        time.textContent = formatTime(entry.timestamp);
        meta.append(name, time);

        const bubble = document.createElement('div');
        bubble.className = 'np-chat-bubble';
        bubble.textContent = entry.text;

        body.append(meta, bubble);

        if (typeof options.onPromote === 'function') {
            const promote = document.createElement('button');
            promote.type = 'button';
            promote.className = 'np-chat-promote';
            promote.textContent = 'Add to task';
            promote.title = 'Promote this message to a task comment';
            promote.addEventListener('click', () => options.onPromote(entry));
            body.appendChild(promote);
        }

        row.append(chip, body);
        return row;
    }

    /**
     * Render `entries` into `list`, replacing what was there.
     *
     * options.selfName   -- the reader's own display name; their messages
     *                       sit on the right.
     * options.ownIds     -- a Set of the ids of the reader's own messages.
     *                       When given, it decides instead of selfName.
     * options.onPromote  -- when given, each message gets an "Add to task"
     *                       action calling it with the entry (host only).
     * options.emptyText  -- shown when there is nothing yet.
     */
    function render(list, entries, options) {
        if (!list) return;
        const opts = options || {};
        list.textContent = '';
        if (!entries || !entries.length) {
            const empty = document.createElement('p');
            empty.className = 'np-chat-empty';
            empty.textContent = opts.emptyText || 'Messages and session activity will appear here.';
            list.appendChild(empty);
            return;
        }
        for (const entry of entries) {
            list.appendChild(entry.type === 'activity' ? buildActivity(entry) : buildMessage(entry, opts));
        }
        list.scrollTop = list.scrollHeight;
    }

    const api = { render, initials, formatTime };
    global.NoodleCollabChat = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
