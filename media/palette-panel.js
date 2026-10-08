/* Only typed messages and DOM text nodes cross the webview boundary. */
(() => {
    const api = acquireVsCodeApi();
    const token = document.body.dataset.token;
    const send = (action, values = {}) => api.postMessage({ token, action, ...values });
    const form = document.querySelector('#metadata');
    const feedback = document.querySelector('#feedback');
    const members = () => [...document.querySelectorAll('[data-member]')].map(row => row.dataset.key);
    const draft = () => {
        const fields = {};
        for (const input of form.querySelectorAll('[name]')) {
            if (input.name === 'sourceName') { continue; }
            if (['name', 'version'].includes(input.name) || input.value !== input.dataset.base || form.dataset.new === 'true' && input.value) {
                fields[input.name] = ['tags', 'features', 'languages', 'authors', 'sources'].includes(input.name)
                    ? input.value.split('\n').map(value => value.trim()).filter(Boolean) : input.value;
            }
        }
        // Unchanged dependency rows retain their original indexes and unknown child fields.
        const dependencies = [...document.querySelectorAll('[data-dependency]')].map(row => ({
            ...(row.dataset.index === undefined ? {} : { originalIndex: Number(row.dataset.index) }),
            id: row.dataset.id, name: row.dataset.name, version: row.querySelector('[data-constraint]').value,
        }));
        return { fields, members: members(), dependencies, sourceName: form.querySelector('[name="sourceName"]')?.value };
    };
    form?.addEventListener('input', () => send('dirty'));
    form?.addEventListener('submit', event => { event.preventDefault(); const values = draft(); for (const button of form.querySelectorAll('button')) { button.disabled = true; } send('save', values); });
    document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]'); if (!button) { return; }
        const action = button.dataset.action;
        if (action === 'removeMember' || action === 'removeDependency') {
            button.closest('li').remove(); send('dirty'); if (action === 'removeMember') { send('preview', draft()); } return;
        }
        if (action === 'searchMembers' || action === 'searchDependencies') {
            send(action, { query: document.querySelector(action === 'searchMembers' ? '#member-query' : '#dependency-query').value }); return;
        }
        if (action === 'preview') { send(action, draft()); return; }
        send(action, { key: button.dataset.key, source: button.dataset.source });
    });
    window.addEventListener('message', event => {
        const message = event.data; if (!message || message.token !== token) { return; }
        if (message.type === 'closure') { document.querySelector('#closure').textContent = message.text; return; }
        if (message.type === 'error') { feedback.textContent = message.text; if (form) { for (const button of form.querySelectorAll('button')) { button.disabled = false; } } return; }
        if (message.type !== 'candidates' || !Array.isArray(message.items)) { return; }
        const dependency = message.purpose === 'dependencies';
        const container = document.querySelector(dependency ? '#dependency-candidates' : '#candidates'); container.replaceChildren();
        for (const item of message.items) {
            const row = document.createElement('li'); const label = document.createElement('span'); label.textContent = item.label;
            const add = document.createElement('button'); add.type = 'button'; add.textContent = 'Add';
            add.addEventListener('click', () => {
                const target = document.querySelector(dependency ? '#dependencies' : '#members');
                if ([...target.children].some(child => dependency ? child.dataset.id === item.id : child.dataset.key === item.key)) { return; }
                const selected = document.createElement('li'); const title = document.createElement('span'); title.textContent = item.label; selected.append(title);
                if (dependency) {
                    selected.dataset.dependency = ''; selected.dataset.id = item.id; selected.dataset.name = item.name;
                    const constraintLabel = document.createElement('label'); constraintLabel.textContent = 'Version constraint';
                    const constraint = document.createElement('input'); constraint.dataset.constraint = ''; constraint.value = '=' + item.version; constraintLabel.append(constraint); selected.append(constraintLabel);
                } else { selected.dataset.member = ''; selected.dataset.key = item.key; }
                const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.action = dependency ? 'removeDependency' : 'removeMember'; remove.textContent = 'Remove'; selected.append(remove); target.append(selected);
                send('dirty'); if (!dependency) { send('preview', draft()); }
            });
            row.append(label, add); container.append(row);
        }
    });
})();
