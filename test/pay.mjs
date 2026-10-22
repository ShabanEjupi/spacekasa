// End-to-end payment in the PayPal sandbox: the cashier's screen proposes a QR sale, confirms it, a sandbox buyer
// pays on the approve link in a separate browser, and the card must turn "Paid" by itself.
//   node pay.mjs <base-url> <buyer-email> <buyer-password> <out-dir>
import { chromium } from 'playwright';
const [base, email, pass, out] = process.argv.slice(2);
const b = await chromium.launch();
const till = await b.newPage({ viewport: { width: 1280, height: 720 } });
await till.goto(base);
await till.fill('#q', 'One espresso, paying now by QR');
await till.click('#go');
await till.waitForSelector('.card.proposal', { timeout: 120000 });
await till.click('.card.proposal .primary');
await till.waitForSelector('.card.payment .qr svg', { timeout: 30000 });
const url = await till.getAttribute('.card.payment a.btn', 'href');
console.log('approve', url);

const buyer = await (await b.newContext({ locale: 'en-US' })).newPage();
await buyer.goto(url);
await buyer.fill('#email', email, { timeout: 60000 });
await buyer.click('#btnNext');
await buyer.fill('#password', pass, { timeout: 30000 });
await buyer.click('#btnLogin');
const pay = buyer.locator('#payment-submit-btn, button:has-text("Complete Purchase"), button:has-text("Pay"), button:has-text("Continue to Review Order")').first();
await pay.click({ timeout: 60000 });
await buyer.waitForURL(/\/paid\?/, { timeout: 60000 });
console.log('buyer page:', (await buyer.locator('main').innerText()).replace(/\s+/g, ' '));
await buyer.screenshot({ path: `${out}/pay-buyer.png` });

await till.waitForSelector('.card.payment.s-paid', { timeout: 30000 });
await till.screenshot({ path: `${out}/pay-till.png` });
console.log('till card:', (await till.locator('.card.payment.s-paid').innerText()).replace(/\s+/g, ' '));

// Same till: ask for a refund, confirm it, and the card must say Refunded.
const ref = (await till.locator('.card.payment.s-paid .kicker span').first().innerText()).split(' ')[0];
await till.fill('#q', `Refund ${ref}, the customer brought it back`);
await till.click('#go');
await till.waitForSelector('.card.proposal', { timeout: 120000 });
await till.click('.card.proposal .primary');
await till.waitForSelector('.card.payment.s-refunded', { timeout: 30000 });
await till.screenshot({ path: `${out}/pay-refund.png` });
console.log('refund card:', (await till.locator('.card.payment.s-refunded').innerText()).replace(/\s+/g, ' '));
await b.close();
