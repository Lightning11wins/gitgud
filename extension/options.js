import { buildRules, originFromRules, parseOrigin, REDIRECT_RULE_ID, RESERVED_RULE_ID } from "./rules.js";

const dnr = browser.declarativeNetRequest;
const GITHUB = { origins: ["https://github.com/*"] };
const form = document.getElementById("form");
const input = document.getElementById("url");
const status = document.getElementById("status");
const access = document.getElementById("access");

function show(origin) {
  status.className = "";
  status.textContent = origin ? `GitHub links open in ${origin}.` : "Enter your GitGud URL to start redirecting.";
}

async function checkAccess() {
  access.hidden = await browser.permissions.contains(GITHUB);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  const origin = text ? parseOrigin(text) : null;
  if (text && !origin) {
    status.className = "error";
    status.textContent = `Failed to read "${text}" as an http or https URL.`;
    return;
  }
  try {
    await dnr.updateDynamicRules({
      removeRuleIds: [REDIRECT_RULE_ID, RESERVED_RULE_ID],
      addRules: origin ? buildRules(origin) : [],
    });
  } catch (err) {
    status.className = "error";
    status.textContent = `Failed to save redirect to ${origin}: ${err.message}`;
    return;
  }
  input.value = origin ?? "";
  show(origin);
});

document.getElementById("grant").addEventListener("click", async () => {
  await browser.permissions.request(GITHUB);
  await checkAccess();
});

const origin = originFromRules(await dnr.getDynamicRules());
input.value = origin ?? "";
show(origin);
await checkAccess();
