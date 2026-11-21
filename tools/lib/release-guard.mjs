/**
 * release-guard.mjs - the one gate every script that could upload, publish, price or release must pass.
 *
 * AC36: only the creator runs those steps. The gate refuses unless ALL of these hold:
 *   1. the explicit flag --i-am-the-creator-approving is present,
 *   2. this is not a CI run (CI, GITHUB_ACTIONS, ... in the environment),
 *   3. stdin and stdout are both a real terminal (so nothing can pipe an answer in),
 *   4. the person types the exact confirmation phrase at the prompt.
 * Anything else exits non-zero without doing the action.
 */
import readline from 'node:readline';

export const APPROVAL_FLAG = '--i-am-the-creator-approving';
export const CONFIRM_PHRASE = 'UPLOAD';
const CI_VARS = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'TF_BUILD', 'JENKINS_URL', 'TEAMCITY_VERSION', 'APPVEYOR', 'CIRCLECI', 'TRAVIS'];

/** True when the environment looks like a CI runner. "0" and "false" count as unset. */
export function isCi(env = process.env) {
    return CI_VARS.some((k) => {
        const v = env[k];
        return v !== undefined && v !== '' && v !== '0' && String(v).toLowerCase() !== 'false';
    });
}

/**
 * Pure, synchronous pre-checks (everything except the typed answer).
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function checkApproval({ argv = process.argv.slice(2), env = process.env, stdinIsTTY = process.stdin.isTTY, stdoutIsTTY = process.stdout.isTTY } = {}) {
    if (!argv.includes(APPROVAL_FLAG)) return { ok: false, reason: `missing the explicit flag ${APPROVAL_FLAG}` };
    if (isCi(env)) return { ok: false, reason: 'running in CI; only the creator may run this, interactively' };
    if (!stdinIsTTY || !stdoutIsTTY) return { ok: false, reason: 'not an interactive terminal (stdin and stdout must be a TTY)' };
    return { ok: true };
}

/** Whether a typed answer is the confirmation phrase. */
export function isConfirmed(answer) {
    return typeof answer === 'string' && answer.trim() === CONFIRM_PHRASE;
}

/** Read one line from the terminal. Resolves exactly once with the typed answer ('' if the stream closes first). */
export function ask(question, { input = process.stdin, output = process.stdout } = {}) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input, output });
        let done = false;
        const finish = (a) => { if (done) return; done = true; resolve(a); };
        rl.once('close', () => finish(''));
        rl.question(question, (a) => { finish(a); rl.close(); });
    });
}

/**
 * Gate an action. Resolves only when approved; otherwise prints why and exits the process non-zero.
 * Order: flag/CI/TTY pre-checks, then the optional `preflight` (cheap checks such as a missing App ID; returns an
 * error string or null) so the creator is never asked to type anything for a run that would fail anyway, then the prompt.
 * @param {string} action human description of what is about to happen
 * @param {{preflight?:()=>string|null, ask?:Function, exit?:Function}} opts (plus checkApproval overrides; ask/exit are injectable for tests)
 */
export async function requireCreatorApproval(action, opts = {}) {
    const { preflight, ask: askFn = ask, exit = (c) => process.exit(c), ...approval } = opts;
    const pre = checkApproval(approval);
    if (!pre.ok) {
        console.error(`REFUSED: ${pre.reason}.
This step (${action}) is for the creator only. See docs/steam-handoff.md.`);
        return exit(2);
    }
    const problem = preflight ? preflight() : null;
    if (problem) {
        console.error(`REFUSED: ${problem}`);
        return exit(4);
    }
    console.log(`
You are about to: ${action}
This can publish content to Steam. Nothing runs unless you confirm.`);
    const answer = await askFn(`Type ${CONFIRM_PHRASE} to continue, anything else aborts: `);
    if (!isConfirmed(answer)) {
        console.error('Aborted: confirmation not given. Nothing was uploaded.');
        return exit(3);
    }
    return true;
}
