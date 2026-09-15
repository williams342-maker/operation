/* global document, innerWidth, window */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { resolveFoundryCheckConfig } from './foundry-check-config.mjs';
// Resolved BEFORE the browser launches: a misconfigured origin or credential should fail in
// milliseconds rather than after Chromium starts. See foundry-check-config.mjs for the rules,
// the important one being that the local-preview credentials can never be sent off-box.
const { origin, email, password, organizationSlug } = resolveFoundryCheckConfig(process.env);
const out=path.resolve(process.env.FOUNDRY_EVIDENCE_DIR || '../../browser-evidence');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.FOUNDRY_BROWSER_CHANNEL || 'msedge',headless:true});
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(); page.setDefaultTimeout(15000); const errors=[]; const requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>route.request().url().startsWith(origin) ? route.continue() : route.abort());
 page.on('request',req=>{if(req.method()!=='GET') requests.push({method:req.method(),url:new URL(req.url()).pathname});});
 async function shot(name,width=1440){await page.setViewportSize({width,height:1000}); await page.evaluate(()=>window.scrollTo(0,0)); await page.screenshot({path:path.join(out,name+'.png'),fullPage:true}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false, name+' horizontal overflow'); const accessibility=await new AxeBuilder({page}).exclude('iframe').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze(); await fs.writeFile(path.join(out,name+'-a11y.json'),JSON.stringify(accessibility.violations,null,2)); assert.deepEqual(accessibility.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name+' accessibility');}
 await page.goto(origin+'/foundry'); await page.getByRole('heading',{level:1}).waitFor();
 await shot('landing-desktop');await shot('landing-mobile',390);
 // organizationSlug is sent only when supplied: the login route falls back to the single-organisation
 // lookup without it, which is correct for a one-org environment and fails in a multi-org one.
 const login=await context.request.post(origin+'/api/auth/login',{data:{email,password,...(organizationSlug?{organizationSlug}:{})}});
 assert.equal(login.status(),200); const auth=await login.json();
 await page.evaluate(csrf=>localStorage.setItem('cc.csrf',csrf),auth.csrfToken);
 await page.goto(origin+'/foundry/new');
 const composer=page.getByRole('textbox',{name:'Describe what you want to build'});
 await composer.fill('Build a business called Cedar Bakery for local families.');
 await page.reload();await composer.waitFor();assert.match(await composer.inputValue(),/Cedar Bakery/);
 await shot('new-project-mobile',390);
 await page.getByRole('button',{name:'Start Building'}).click();
 await page.waitForURL(/\/foundry\/projects\/[a-f0-9]{24}$/);
 const projectUrl=page.url();
 await page.getByRole('button',{name:'Approve preview',exact:true}).waitFor();
 const frame=page.frameLocator('iframe[title="Generated website preview"]');
 await frame.getByRole('heading',{level:1}).waitFor();
 assert.match(await frame.getByRole('heading',{level:1}).innerText(),/Cedar Bakery/);
 assert.equal(await page.locator('iframe').getAttribute('sandbox'),'');
 for(const width of [320,390,768,1440]) await shot('workspace-'+width,width);
 await page.getByRole('button',{name:'Reject: Strengthen the homepage headline and call to action'}).click();
 await page.getByRole('button',{name:'Reject: Strengthen the homepage headline and call to action'}).waitFor({state:'detached'});
 // Accepting a suggestion bumps the workflow version, and the brief PATCH carries a version the
 // server checks. Clicking straight through to Edit brief races that refresh: roughly half the
 // time the save went out stale and the server correctly refused it with
 //   409 {"error":"Project changed or version missing. Reload before making this decision."}
 // which surfaced as this journey timing out waiting for the updated heading. The reject above
 // already waits for its button to detach; the accept did not, and that asymmetry was the bug.
 const acceptChange = page.getByRole('button',{name:'Accept change',exact:true}).first();
 await acceptChange.click();
 await acceptChange.waitFor({state:'detached'});
 await page.getByRole('button',{name:'Edit brief',exact:true}).click();
 await page.getByRole('textbox',{name:'Business or project name',exact:true}).fill('Cedar Bakery Updated');
 await page.getByRole('button',{name:'Save and refresh preview'}).click();
 await page.getByRole('heading',{name:'Cedar Bakery Updated',level:1}).waitFor();
 await frame.getByRole('heading',{level:1}).filter({hasText:'Cedar Bakery Updated'}).waitFor();
 await frame.getByRole('link',{name:'Contact',exact:true}).click();
 assert.equal(page.url(),projectUrl);
 await frame.getByRole('heading',{level:1}).filter({hasText:'Cedar Bakery Updated'}).waitFor();
 await frame.getByRole('link',{name:'Home',exact:true}).click();
 await page.getByRole('button',{name:'Approve preview',exact:true}).click();
 await page.getByText('Preview approved.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Edit brief',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:/Publish to production/}).isDisabled(),true);
 await shot('approved-desktop');await shot('approved-mobile',390);
 await page.reload();await page.getByText('Preview approved.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'My Projects'}).click();
 await page.getByRole('heading',{name:'Your projects'}).waitFor();await shot('projects-mobile',390);
 await page.getByRole('button',{name:'New project',exact:true}).click();
 await composer.fill('Keep this draft through back and forward navigation');
 await page.goBack();await page.goForward();await composer.waitFor();assert.match(await composer.inputValue(),/Keep this draft/);
 await page.goto(origin+'/foundry/projects/000000000000000000000000');
 await page.getByRole('heading',{name:"We couldn't open this project"}).waitFor();
 assert.equal(await page.locator('iframe').count(),0);await shot('denied-project',390);
 await page.goto(origin+'/foundry/new');await composer.waitFor();await composer.focus();await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'BUTTON');
 assert.equal(requests.some(r=>/publish|deploy|credits|provider/.test(r.url)),false);
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({passed:true,widths:[320,390,768,1440],journey:'create, recover draft, isolated preview, reject/accept suggestion, edit brief, approve, reload, projects, navigation, denied project',pageErrors:errors,mutationPaths:[...new Set(requests.map(r=>r.url))]},null,2));
 console.log('PASS: real-browser Foundry journey, widths 320/390/768/1440, isolation and disabled publishing');
} finally { await browser.close(); }
