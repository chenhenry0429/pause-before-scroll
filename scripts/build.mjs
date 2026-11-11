import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
await build({entryPoints:['docs/entry.mjs'],bundle:true,format:'iife',target:['chrome70','safari13'],outfile:'docs/app-compat.js',charset:'utf8',legalComments:'none'});
await build({entryPoints:['scripts/sw-source.js'],target:['chrome70','safari13'],outfile:'docs/sw.js',charset:'utf8',legalComments:'none'});
let html=await readFile('docs/index.html','utf8');const guard=(await readFile('scripts/startup-guard.js','utf8')).trim();
html=html.replace(/<!-- STARTUP_GUARD_START -->[\s\S]*?<!-- STARTUP_GUARD_END -->/,'<!-- STARTUP_GUARD_START --><script>'+guard+'</script><!-- STARTUP_GUARD_END -->');
await writeFile('docs/index.html',html);
console.log('Built classic-script app for older mobile browsers.');
