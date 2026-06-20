"""
core/selectors.py — Centralized Registry of URLs and CSS Selectors for Harvesters.
Allows easy modification when provider websites update.
"""

from __future__ import annotations
from .config import Config

SELECTORS = {
    # ── Common / Global Selectors ─────────────────────────────────────────────
    "common": {
        "CANCEL_BTN": [
            "div.gap-2:nth-child(4) > button:nth-child(2)",
            "button:has-text('Cancel')",
        ],
    },
    # ── Google Login Flow ─────────────────────────────────────────────────────
    "google_login": {
        "EMAIL_INPUT": [
            "input[type='email']",
            "#identifierId",
            "input[name='identifier']",
        ],
        "EMAIL_NEXT_BTN": [
            "#identifierNext > div > button",
            "#identifierNext button",
            "#identifierNext",
        ],
        "PASSWORD_INPUT": [
            "input[type='password']",
            "#password > div.aCsJod.oJeWuf > div > div.Xb9hP > input",
            "input[name='Passwd']",
        ],
        "PASSWORD_NEXT_BTN": [
            "#passwordNext > div > button",
            "#passwordNext button",
            "#passwordNext",
        ],
        "ACCOUNT_CHOOSER": [
            "div[data-identifier]",
            "div[data-email]",
            "li[data-identifier]",
            "li[data-email]",
            "div.BHzsHc",
            "li[role='link']",
            "div[role='link']",
            "[role='listitem']",
        ],
        "CONSENT_BTNS": [
            "button.inline-flex:nth-child(2)",
            "button:has-text('Lanjutkan')",
            "button:has-text('Continue')",
            "button:has-text('Sign In')",
            "button:has-text('Lanjut')",
            "button:has-text('Allow')",
            "#submit_approve_access",
            'button[jsname="LgbsSe"]',
        ],
        "SPEEDBUMP_BTNS": [
            "#gaplustosNext button",
            "#confirm",
            'input[type="submit"]',
        ],
    },
    # ── Google AI Studio (Gemini) ─────────────────────────────────────────────
    "gemini": {
        "URL_WELCOME": "https://aistudio.google.com/welcome",
        "URL_API": "https://aistudio.google.com/app/api-keys",
        "WELCOME_CTA": [
            "a > span:has-text('Get started')",
            "a:has-text('Try AI Studio')",
            "a.nav__cta",
        ],
        "TOS_CHECKBOX": [
            "input[type='checkbox']",
            "mat-checkbox input",
        ],
        "TOS_CONTINUE": [
            "button:has-text('Continue')",
            "button:has-text('I agree')",
            "form button[type='submit']",
            "mat-dialog-actions button",
        ],
        "DISMISS_BANNER": [
            "button:has-text('Dismiss')",
        ],
        "COPY_KEY_BTN": [
            "button[aria-label*='copy' i]",
            "button.xap-copy-to-clipboard",
        ],
        "CREATE_KEY_BTN": [
            "button:has-text('Create API key')",
        ],
        "PROJECT_DROPDOWN": [
            "button[role='combobox']",
            "mat-form-field",
        ],
        "CREATE_PROJECT_OPTION": [
            "mat-option:has-text('Create project')",
        ],
        "PROJECT_NAME_INPUT": [
            "input[aria-label*='project' i]",
            "input[aria-label*='Name' i]",
            "input[placeholder*='project' i]",
            "input[type='text']",
        ],
        "PROJECT_CREATE_SUBMIT": [
            "button:has-text('Create project')",
            "button[type='submit']",
        ],
        "KEY_CREATE_SUBMIT": [
            "button:has-text('Create key')",
            "button[type='submit']",
        ],
        "DIALOG_COPY_KEY": [
            "button:has-text('Copy key')",
            "button[aria-label*='copy' i]",
        ],
    },
    # ── Cohere ────────────────────────────────────────────────────────────────
    "cohere": {
        "URL_KEYS": "https://dashboard.cohere.com/api-keys",
        "GOOGLE_BTNS": [
            "button:has-text('Continue with Google')",
            "button.group:nth-child(1)",
            "button.group",
            "button:has-text('Google')",
            "button:has-text('Sign in with Google')",
        ],
        "FIRST_NAME_INPUT": [
            "#name",
            "input[name='name']",
            "input[placeholder*='first name' i]",
        ],
        "LAST_NAME_INPUT": [
            "#lastName",
            "input[name='lastName']",
            "input[placeholder*='last name' i]",
        ],
        "SUBMIT_ONBOARDING_1": [
            "form button[type='submit']",
            "button:has-text('Continue')",
        ],
        "STUDENT_RADIO": [
            "div[role='radio']:has-text('Student')",
            "#headlessui-radio-_r_6_ > div",
            "[role='radio']:has-text('Student')",
            "div:has-text('Student')",
        ],
        "ROLE_OPTION": [
            "label.relative:nth-child(3) > input:nth-child(1)",
            "input[type='checkbox']",
            "#__next > div > div.relative.mx-auto.flex.h-full.min-h-screen.w-full.max-w-page.flex-col.overflow-y-auto > div.my-auto.w-full.px-6.pb-6.md\\:mx-auto.md\\:w-fit.md\\:px-0.md\\:py-4 > div > form > div.grid.grid-cols-1.md\\:grid-cols-2.mb-10 > label:nth-child(8) > input",
            "label:has-text('Agree') input",
        ],
        "KYC_SUBMIT": [
            "#kycSubmitButton",
            "button:has-text('Submit')",
        ],
        "SHOW_KEY_BTN": [
            "button:has(i.icon-show)",
            "button:has-text('Show')",
            "button:has-text('Reveal')",
            "table button",
        ],
        "VALUE_INPUT": [
            "input[readonly][type='text']",
            "input[readonly][value]",
            "input[type='text'][readonly]",
            "input[readonly]",
        ],
    },
    # ── OpenRouter ────────────────────────────────────────────────────────────
    "openrouter": {
        "URL_KEYS": "https://openrouter.ai/keys",
        "CLERK_GOOGLE_BTNS": [
            "button:has(img[alt='Sign in with Google'])",
            "button[data-provider='google']",
            "button:has-text('Google')",
        ],
        "LEGAL_CHECKBOX": [
            "input[type='checkbox'][name='legalAccepted']",
            "input[type='checkbox']",
            "input[name='legalAccepted']",
        ],
        "LEGAL_SUBMIT": [
            "button:has-text('Continue')",
            "form button[type='submit']",
        ],
        "CREATE_KEY_BTN": [
            "button:has-text('Create key')",
            "button:has-text('New key')",
            "button:has-text('Add key')",
        ],
        "KEY_NAME_INPUT": [
            "#name",
            "input[placeholder*='Chatbot Key']",
        ],
        "SUBMIT_BTN": [
            "button.border-input:nth-child(1)",
            "button:has-text('Create')",
        ],
        "EXTRACT_CODE": [
            "code",
        ],
        "POPUP": [
            "button.gap-3:nth-child(1)",
        ],
        "POPUP_CLOSE": [
            "div.gap-2:nth-child(2) > a:nth-child(2) > button:nth-child(1)",
            "button:has-text('Create API Key')",
        ],
        "ONBOARD_GAP_BTN": ["button.gap-4:nth-child(1)"],
        "ONBOARD_COPY_BTN": ["button.leading-6:nth-child(2)"],
        "ONBOARD_CONTINUE": ["button:has-text('Continue')"],
        "ONBOARD_SKIP": ["button:has-text(\"I'll do this later\")"],
        "ONBOARD_FLEX_BTN": ["button.flex:nth-child(7)"],
        "ONBOARD_DASHBOARD": ["button:has-text('Go to Dashboard')"],
    },
    # ── SiliconFlow ───────────────────────────────────────────────────────────
    "siliconflow": {
        "URL_LOGIN": "https://account.siliconflow.com/en/login",
        "URL_KEYS": "https://cloud.siliconflow.com/me/account/ak",
        "GOOGLE_BTNS": [
            "button:has-text('Continue with Google')",
            "button:has-text('Sign in with Google')",
            "button:has-text('Google')",
        ],
        "CREATE_KEY_BTN": [
            "button.ant-btn:nth-child(2)",
            "button.ant-btn-primary:nth-child(1)",
        ],
        "KEY_NAME_INPUT": [
            "input[placeholder*='name' i]",
            "input[type='text']",
        ],
        "SUBMIT_BTN": [
            "button.ant-btn:nth-child(2)",
        ],
        "SHOW_KEY_BTN": [
            "td.ant-table-cell:nth-child(1) > div:nth-child(1)",
            "tr.ant-table-row:nth-child(1) > td:nth-child(1) > div:nth-child(1)",
        ],
        "EXTRACT_SPAN": [
            "td.sf-apikey-copable > div > span",
            "input[readonly]",
            "code",
            "span",
        ],
    },
    # ── Deno ──────────────────────────────────────────────────────────────────
    "deno": {
        "URL_WELCOME": "https://console.deno.com/",
        "LOGIN_GOOGLE": "a:has-text('Sign in with Google')",
        "TOS_CHECKBOX": "#tos-modal > div > div > div > label > input",
        "TOS_CONTINUE": "button:has-text('Continue')",
        "CREATE_ORG_BTN": "button:has-text('Create organization')",
        "ORG_NAME_SPAN": "#main > div > div > div.min-w-0.flex-1 > div.flex.justify-start.items-center.gap-2.min-w-0 > h1 > span",
        "SETTINGS_LINK": "a:has-text('Settings')",
        "ADD_TOKEN_BTN": "#organizationTokens > div.w-full > div > table > tbody > tr:nth-child(2) > td > button",
        "TOKEN_DESC": "#description",
        "TOKEN_EXPIRY_SELECT": "#token-create-drawer select",
        "CREATE_TOKEN_SUBMIT": "button:has-text('Create token')",
        "TOKEN_RESULT_CODE": "#token-create-drawer pre > code",
        # Dashboard Relay Deploy
        "URL_PROXY_POOLS": "http://localhost:20128/dashboard/proxy-pools",
        "DEPLOY_RELAY_BTN": ["button.hover\:bg-brand-600:nth-child(1)", "button:has-text('Deploy Relay')"],
        "DENO_RELAY_OPTION": "button:has-text('Deno Relay')",
        "INPUT_TOKEN": "input[placeholder='ddo_xxxxxxxxxxxxxxxx']",
        "INPUT_DOMAIN": "input[placeholder='your-org.deno.net']",
        "INPUT_RELAY_NAME": "input[placeholder='deno-relay']",
        "DEPLOY_SUBMIT": "button:has-text('Deploy Relay')",
    },
    # ── Kiro ──────────────────────────────────────────────────────────────────
    "kiro": {
        "KIRO_AUTH_BASE": "https://prod.us-east-1.auth.desktop.kiro.dev",
        "KIRO_REDIRECT_URI": "kiro://kiro.kiroAgent/authenticate-success",
        "KIRO_TOKEN_ENDPOINT": "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
        "GOOGLE_BTNS": [
             "button:has-text('Continue with Google')",
             "button:has-text('Google')",
        ],
    },
    # ── Local Dashboard Common Selectors ──────────────────────────────────────
    "local_provider": {
        "DASHBOARD_LOGIN_URL": f"{Config.DASHBOARD_BASE_URL}/login",
        "DASHBOARD_PROVIDERS_URL": f"{Config.DASHBOARD_BASE_URL}/dashboard/providers",
        "PASS_INPUT": [
            "input[type='password']",
            "body > div.min-h-screen.flex.items-center.justify-center.bg-bg.p-4.relative.overflow-hidden > div.relative.z-10.w-full.max-w-md > div.bg-surface.border.border-border-subtle.rounded-\\[14px\\].shadow-\\[var\\(--shadow-soft\\)\\].p-6 > div > form > div > div > div > input",
            "input[placeholder*='password' i]",
        ],
        "LOGIN_BTN": [
            "body > div.min-h-screen.flex.items-center.justify-center.bg-bg.p-4.relative.overflow-hidden > div.relative.z-10.w-full.max-w-md > div.bg-surface.border.border-border-subtle.rounded-\\[14px\\].shadow-\\[var\\(--shadow-soft\\)\\].p-6 > div > form > button",
            "button:has-text('Login')",
            "form button[type='submit']",
            "button:has-text('Sign in')",
        ],
        "MODAL_URL_INPUT": [
            "body > div.flex.h-screen.w-full.overflow-hidden.bg-bg > main > div.flex-1.overflow-y-auto.custom-scrollbar.p-6.lg\\:p-10 > div > div > div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4 > div.relative.w-full.bg-surface.border.border-border-subtle.rounded-\\[14px\\].shadow-\\[var\\(--shadow-elev\\)\\].fade-in.max-w-lg > div.p-6.max-h-\\[calc\\(85vh-100px\\)\\].overflow-y-auto.custom-scrollbar > div > div.space-y-4 > div:nth-child(1) > div > div > div > input",
            "div[role='dialog'] input",
            "div.fixed.inset-0 input",
        ],
        "ADD_BTN": [
            "button:has-text('Add'):has(.material-symbols-outlined)",
            "button:has-text('Add Key')",
        ],
        "KIRO_IMPORT_BTN": ["div > div > button:nth-child(7)"],
        "KIRO_NAME_INPUT": [
            "input[placeholder='e.g. work-account']",
        ],
        "KIRO_TOKEN_INPUT": [
            "input[placeholder*='auto-filled']",
            "div > div > input",
        ],
        "KIRO_SUBMIT_IMPORT": ["button:has-text('Import Token')"],
        "KIRO_VALIDATION": ["p:has-text('Token validation failed')"],
        "CANCEL_BTN": [
            "div[role='dialog'] button:has-text('Cancel')",
            "button:has-text('Cancel')",
            "div.gap-2:nth-child(4) > button:nth-child(2)",
        ],
        "KEY_NAME_INPUT": [
            "div[role='dialog'] input[placeholder='Production Key']",
            "input[placeholder='Production Key']",
            "div.fixed.inset-0 input[placeholder='Production Key']",
        ],
        "API_KEY_INPUT": [
            "div[role='dialog'] input[type='password']",
            "input[placeholder*='API key' i]",
            "div.fixed.inset-0 input[type='password']",
        ],
        "CHECK_BTN": [
            "div[role='dialog'] button:has-text('Check')",
            "button:has-text('Check')",
            "div.fixed.inset-0 button:has-text('Check')",
        ],
        "SAVE_BTN": [
            "button:has-text('Save')",
            "div[role='dialog'] button:has-text('Save')",
            "div.fixed.inset-0 button:has-text('Save')",
        ],
        "APPLY_PROXY_BTN": [
            "button:has-text('Apply Proxy')",
            "div.mb-4.flex.flex-col.gap-3.sm\:flex-row.sm\:items-center.sm\:justify-between > div > button:nth-child(1)"
        ],
        "CONFIRM_PROXY_BTN": [
            "div.p-6.max-h-\[calc\(85vh-100px\)\].overflow-y-auto.custom-scrollbar > div > div > button:nth-child(1)",
            "div.relative.w-full.bg-surface.border button:nth-child(1)"
        ],
        "VALID_KEY": [
            "span:has-text('Valid')",
            "div[role='dialog'] span:has-text('Valid')",
        ],
        "AUTHORIZE_BTN": [
            "body > div.bg-background.flex.min-h-screen.items-center.justify-center.p-4 > div > div.p-6.pt-0.space-y-4 > div:nth-child(4) > button.inline-flex.items-center.justify-center.gap-2.whitespace-nowrap.rounded-md.text-sm.font-medium.transition-colors.cursor-pointer.focus-visible\\:outline-none.focus-visible\\:ring-1.focus-visible\\:ring-ring.disabled\\:pointer-events-none.disabled\\:opacity-50.\\[\\&_svg\\]\\:pointer-events-none.\\[\\&_svg\\]\\:size-4.\\[\\&_svg\\]\\:shrink-0.bg-primary.text-primary-foreground.shadow.hover\\:bg-primary\\/90.h-9.px-4.py-2.flex-1",
            "button:has-text('Authorize')",
            "body > div.bg-background.flex.min-h-screen.items-center.justify-center.p-4 > div > div.p-6.pt-0.space-y-4 > div:nth-child(4) > button",
            "button:has-text('Allow')",
            "button:has-text('Grant')",
            "button.bg-primary",
        ],
        "MODAL_KEY_INPUT": [
            "body > div.flex.h-screen.w-full.overflow-hidden.bg-bg > main > div.flex-1.overflow-y-auto.custom-scrollbar.p-6.lg\\:p-10 > div > div > div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4 > div.relative.w-full.bg-surface.border.border-border-subtle.rounded-\\[14px\\].shadow-\\[var\\(--shadow-elev\\)\\].fade-in.max-w-lg > div.p-6.max-h-\\[calc\\(85vh-100px\\)\\].overflow-y-auto.custom-scrollbar > div > div.space-y-4 > div:nth-child(1) > div > div > div > input",
            "div[role='dialog'] input",
            "div.fixed.inset-0 input[readonly]",
            "div.fixed.inset-0 input",
            "div[role='dialog'] input[readonly]",
        ],
        "ADD_BTN": [
            "button:has-text('Add'):has(.material-symbols-outlined)",
            "button:has-text('Add Connection')",
            "button.bg-primary",
        ],
        "MODAL_API_NAME_INPUT": [
            r"body > div.flex.h-screen.w-full.overflow-hidden.bg-bg > main > div.flex-1.overflow-y-auto.custom-scrollbar.p-6.lg\:p-10 > div > div > div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4 > div.relative.w-full.bg-surface.border.border-border-subtle.rounded-\[14px\].shadow-\[var\(--shadow-elev\)\].fade-in.max-w-md > div.p-6.max-h-\[calc\(85vh-100px\)\].overflow-y-auto.custom-scrollbar > div > div:nth-child(2) > div > input",
            "div[role='dialog'] input[placeholder*='Name' i]",
            "div.fixed.inset-0 input[type='text']:not([readonly])",
        ],
        "MODAL_API_KEY_INPUT": [
            r"body > div.flex.h-screen.w-full.overflow-hidden.bg-bg > main > div.flex-1.overflow-y-auto.custom-scrollbar.p-6.lg\:p-10 > div > div > div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4 > div.relative.w-full.bg-surface.border.border-border-subtle.rounded-\[14px\].shadow-\[var\(--shadow-elev\)\].fade-in.max-w-md > div.p-6.max-h-\[calc\(85vh-100px\)\].overflow-y-auto.custom-scrollbar > div > div:nth-child(3) > div.flex.flex-col.gap-1\.5.flex-1 > div > input",
            "div[role='dialog'] input[type='password']",
            "div.fixed.inset-0 input[type='password']",
        ],
        "MODAL_CHECK_BTN": [
            r"body > div.flex.h-screen.w-full.overflow-hidden.bg-bg > main > div.flex-1.overflow-y-auto.custom-scrollbar.p-6.lg\:p-10 > div > div > div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4 > div.relative.w-full.bg-surface.border.border-border-subtle.rounded-\[14px\].shadow-\[var\(--shadow-elev\)\].fade-in.max-w-md > div.p-6.max-h-\[calc\(85vh-100px\)\].overflow-y-auto.custom-scrollbar > div > div:nth-child(3) > div.pt-6 > button",
            "div[role='dialog'] button:has-text('Check')",
            "button:has-text('Check')",
        ],
        "MODAL_VALID_SPAN": [
            r"body > div.flex.h-screen.w-full.overflow-hidden.bg-bg > main > div.flex-1.overflow-y-auto.custom-scrollbar.p-6.lg\:p-10 > div > div > div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4 > div.relative.w-full.bg-surface.border.border-border-subtle.rounded-\[14px\].shadow-\[var\(--shadow-elev\)\].fade-in.max-w-md > div.p-6.max-h-\[calc\(85vh-100px\)\].overflow-y-auto.custom-scrollbar > div > span",
            "div[role='dialog'] span:has-text('Valid')",
        ],
        "MODAL_SAVE_BTN": [
            r"body > div.flex.h-screen.w-full.overflow-hidden.bg-bg > main > div.flex-1.overflow-y-auto.custom-scrollbar.p-6.lg\:p-10 > div > div > div.fixed.inset-0.z-50.flex.items-center.justify-center.p-4 > div.relative.w-full.bg-surface.border.border-border-subtle.rounded-\[14px\].shadow-\[var\(--shadow-elev\)\].fade-in.max-w-md > div.p-6.max-h-\[calc\(85vh-100px\)\].overflow-y-auto.custom-scrollbar > div > div:nth-child(9) > button",
            "div[role='dialog'] button:has-text('Save')",
            "button:has-text('Save')",
        ],
    },
    # ── Antigravity ───────────────────────────────────────────────────────────
    "antigravity": {
        "ADD_BTN": [
            ".hover\\:bg-brand-600",
            "button:has-text('Add'):has(.material-symbols-outlined)",
        ],
        "CONTINUE_BTN": [
            "button:has-text('I Understand, Continue')",
        ],
    },
    "kilo_code": {  
        "ADD_BTN": [
            "button:has-text('Add'):has(.material-symbols-outlined)",
        ],
        "GOOGLE_BTN": [
            "button:has-text('Continue with Google')",
        ],
        "SKIP_BTN": [
            "button:has-text('Skip')",
        ],
        "AUTH_BTN": [
            "button:has-text('Authorize')",
            "button:has-text('Allow')",
        ],
    },
    # ── xAI ───────────────────────────────────────────────────────────────────
    "xai": {
        "ADD_BTN": [
            "button:has-text('Grok Build OAuth')",
        ],
        "GOOGLE_BTN": [
            "button.focus\:outline-\(--btn-text\):nth-child(2)",
            "button:has(span[data-namespace='@xai/icons'])",
        ],
        "AUTHORIZE_BTN": [
            "button.relative:nth-child(2)",
            "button:has-text('Allow')",
        ],
        "VALUE": [
            "input[disabled][readonly][type='text']",
        ],
        "PASTE_CODE_INPUT": [
            "input[placeholder*='callback?code']",
            "input[placeholder*='code']",
            "input[type='text']",
        ],
        "SUBMIT_CODE_BTN": [
            "button.hover\:bg-brand-600:nth-child(1)",
        ],
    },
    # ── Qoder ─────────────────────────────────────────────────────────────────
    "qoder": {
        "ADD_BTN": [
            "button:has-text('Add'):has(.material-symbols-outlined)",
        ],
        "GOOGLE_BTN": [
            "a:has-text('Sign in with Google')",
            "a[href*='/sso/login/google']",
        ],
    },
}

# ── Inject Common Selectors into all providers ────────────────────────────────
for k, v in SELECTORS.items():
    if k != "common":
        for ck, cv in SELECTORS["common"].items():
            if ck not in v:
                v[ck] = cv
