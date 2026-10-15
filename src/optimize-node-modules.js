import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url), subpath = (...parts) => './' + path.posix.join(...parts),
    BUNDLED_DIR = 'bundled', NM_DIR = 'node_modules', PKG_JSON = 'package.json',
    ENTRY_EXTS = ['.js', '.cjs', '.mjs', '/index.js', '/index.cjs', '/index.mjs'],
    JS_RE = /\.(js|mjs|cjs)$/, DOT_SLASH_RE = /^\.\//, POSIX_RE = /\\/g, PKG_SUBPATH = subpath(PKG_JSON),
    SCRIPT_FILE_RE = /([\p{L}\p{N}_.\-/\\]+\.(?:js|cjs|mjs))/u,
    SNAPSHOT_FILE = '.deps-snapshot.json', SKIP_PKGS = new Set(['esbuild', '@esbuild', 'node-gyp-build',
        'node-gyp-build-optional-packages', 'node-addon-api', 'node']),
    EXCLUDE_NAMES = new Set([PKG_JSON, 'package-lock.json', NM_DIR, '.git', '.gitignore', '.npmignore']),
    TARGET_PLAT_MAP = { android: ['linux'], ios: ['darwin'] },
    ABI_ARCH_MAP = { 'arm64-v8a': 'arm64', 'armeabi-v7a': 'arm', 'x86_64': 'x64', 'x86': 'ia32' },
    IOS_ARCHES = ['arm64', 'x64'], INDEX_FILES = ['index.js', 'index.cjs', 'index.mjs'],
    // ==================== 通用工具 ====================
    toPosix = p => p.replace(POSIX_RE, '/'),
    pickCond = (v, prefer) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object') {
            for (const k of prefer) {
                const r = pickCond(v[k], prefer);
                if (r) return r;
            }
        }
        return null;
    },
    // ==================== 快照 ====================
    writeSnapshotFlags = async (snapshotDir, targetPlatform, abiFilters, runtimeMajor) => {
        const p = path.join(snapshotDir, SNAPSHOT_FILE);
        if (!fs.existsSync(p)) return;
        const old = JSON.parse(fs.readFileSync(p, 'utf-8'));
        old.platform = targetPlatform, old.abiFilters = abiFilters, old.runtimeMajor = runtimeMajor;
        old.optimizeHash = SELF_HASH, old.verified = false, old.optimized = true;
        fs.writeFileSync(p, JSON.stringify(old, null, 2));
    },
    // ==================== 扫描工具 ====================
    findPackages = dir => {
        const result = [];
        if (!fs.existsSync(dir)) return result;
        for (const entry of fs.readdirSync(dir)) {
            if (entry === '.bin' || entry.startsWith('.')) continue;
            const full = path.join(dir, entry);
            if (!fs.statSync(full).isDirectory()) continue;
            if (entry === NM_DIR) { result.push(...findPackages(full)); continue; }
            if (entry.startsWith('@')) {
                for (const sub of fs.readdirSync(full)) {
                    const pkgDir = path.join(full, sub);
                    if (fs.statSync(pkgDir).isDirectory()) {
                        result.push(pkgDir);
                        const nested = path.join(pkgDir, NM_DIR);
                        if (fs.existsSync(nested)) result.push(...findPackages(nested));
                    }
                }
            } else {
                result.push(full);
                const nested = path.join(full, NM_DIR);
                if (fs.existsSync(nested)) result.push(...findPackages(nested));
            }
        }
        return result;
    },
    hasNativeModule = dir => {
        let found = false;
        const walk = d => {
            if (found) return;
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                if (f.isDirectory()) walk(path.join(d, f.name));
                else if (f.name.endsWith('.node') || f.name === 'binding.gyp') { found = true; return; }
            }
        };
        try { walk(dir); } catch { }
        return found;
    },
    countJS = dir => {
        let n = 0;
        const walk = d => {
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                if (f.isDirectory()) walk(path.join(d, f.name));
                else if (JS_RE.test(f.name)) n++;
            }
        };
        walk(dir);
        return n;
    },
    findPkgJsons = dir => {
        const out = [],
            walk = d => {
                for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                    const full = path.join(d, f.name);
                    if (f.isDirectory()) {
                        if (f.name === '.bin' || f.name === NM_DIR) continue;
                        walk(full);
                    } else if (f.name === PKG_JSON) out.push(full);
                }
            };
        walk(dir);
        return out;
    },
    // ==================== 合并 ====================
    keyToFilename = key => {
        if (key === '.') return 'index';
        return key.replace(DOT_SLASH_RE, '').replace(/\//g, '__');
    },
    parseEntriesAll = (pkgDir, j) => {
        const isESM = (j.type === 'module'), prefer = isESM ? ['import', 'module', 'node', 'default', 'require']
            : ['require', 'node', 'default', 'import', 'module'], entries = [], wildcards = [],
            tryPath = rel => {
                const p = path.join(pkgDir, rel);
                if (fs.existsSync(p)) return p;
                const exts = ENTRY_EXTS;
                for (const ext of exts) if (fs.existsSync(p + ext)) return p + ext;
                return null;
            };

        if (j.exports && typeof j.exports === 'object') {
            const keys = Object.keys(j.exports), allConditional = keys.every(k => !k.startsWith('.'));
            if (allConditional) {
                const picked = pickCond(j.exports, prefer);
                if (!picked) return { ok: false };
                const abs = tryPath(picked);
                if (!abs) return { ok: false };
                entries.push({ key: '.', entryFile: abs });
                return { ok: true, entries, wildcards };
            }
            for (const key of keys) {
                if (key === PKG_SUBPATH) continue;
                if (key.includes('*')) { wildcards.push(key); continue; }
                const val = j.exports[key], picked = pickCond(Array.isArray(val) ? val[0] : val, prefer);
                if (!picked) continue;
                if (!JS_RE.test(picked)) continue;
                const abs = path.join(pkgDir, picked);
                if (!fs.existsSync(abs)) continue;
                entries.push({ key, entryFile: abs });
            }
            if (entries.length === 0) return { ok: false };
            return { ok: true, entries, wildcards };
        }

        // 无 exports,用 main/module
        let entryFile = null;
        if (j.module) entryFile = tryPath(j.module);
        if (!entryFile && j.main) entryFile = tryPath(j.main);
        if (!entryFile) {
            for (const c of INDEX_FILES) {
                const p = path.join(pkgDir, c);
                if (fs.existsSync(p)) { entryFile = p; break; }
            }
        }
        if (!entryFile || !fs.existsSync(entryFile)) return { ok: false };
        entries.push({ key: '.', entryFile });
        return { ok: true, entries, wildcards };
    },
    mergeAll = async (nmDir, excludePkgs, runtimeMajor) => {
        let esbuild;
        try { esbuild = require('esbuild'); }
        catch { throw new Error('esbuild 未找到,请确认 @flun/node-mobile-app 依赖已安装'); }

        const packages = findPackages(nmDir);
        let merged = 0, skipped = 0, totalDeleted = 0, resMap = null, resLog = null;
        // 调试模式:预扫各包的 postinstall 资源目录,用于统计被阶段1 删除的资源 JS
        if (process.env.OPTIMIZE_DEBUG) {
            resMap = new Map(), resLog = [];
            for (const pkgDir of packages) {
                const pj = path.join(pkgDir, PKG_JSON);
                if (!fs.existsSync(pj)) continue;
                let j;
                try { j = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { continue; }
                if (!j.scripts) continue;
                const items = new Set();
                for (const k of ['postinstall', 'preinstall', 'install', 'prepare']) {
                    const cmd = j.scripts[k];
                    if (!cmd) continue;
                    const sr = extractScript(cmd);
                    if (!sr) continue;
                    const sa = path.resolve(pkgDir, sr);
                    if (!fs.existsSync(sa)) continue;
                    for (const item of extractResources(pkgDir, fs.readFileSync(sa, 'utf8'))) items.add(item);
                }
                if (items.size > 0) resMap.set(pkgDir, items);
            }
        }

        for (const pkgDir of packages) {
            const pj = path.join(pkgDir, PKG_JSON);
            if (!fs.existsSync(pj)) { skipped++; continue; }
            let j;
            try { j = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { skipped++; continue; }
            const relName = toPosix(path.relative(nmDir, pkgDir));
            if (excludePkgs.has(relName)) { skipped++; continue; }
            if (SKIP_PKGS.has(relName)) { skipped++; continue; }
            if (hasNativeModule(pkgDir)) { skipped++; continue; }
            if (countJS(pkgDir) <= 1) { skipped++; continue; }
            // 已优化过的包跳过
            const mainStr = String(j.main || ''), exportsStr = JSON.stringify(j.exports || '');
            if (mainStr.includes(BUNDLED_DIR) || exportsStr.includes(BUNDLED_DIR)) { skipped++; continue; }

            const parse = parseEntriesAll(pkgDir, j);
            if (!parse.ok) { skipped++; continue; }

            const isESM = (j.type === 'module'), bundledDir = path.join(pkgDir, BUNDLED_DIR), newExports = {},
                banner = "import { createRequire as __ebCR } from 'module'; var require = __ebCR(import.meta.url);",
                artifacts = new Set();

            fs.mkdirSync(bundledDir, { recursive: true });
            let entryOk = true;
            for (const e of parse.entries) {
                const baseName = keyToFilename(e.key), outName = baseName + (isESM ? '.mjs' : '.cjs'),
                    outFile = path.join(bundledDir, outName);
                try {
                    await esbuild.build({
                        entryPoints: [e.entryFile],
                        bundle: true,
                        platform: 'node',
                        format: isESM ? 'esm' : 'cjs',
                        target: 'node' + runtimeMajor,
                        outfile: outFile,
                        packages: 'external',
                        banner: isESM ? { js: banner } : undefined,
                        logLevel: 'silent'
                    });
                    artifacts.add(outFile);
                } catch {
                    try { fs.unlinkSync(outFile) } catch { }
                    entryOk = false;
                    break;
                }
                if (isESM) newExports[e.key] = subpath(BUNDLED_DIR, outName);
                else {
                    // CJS 包：若 bundle 末尾是 module.exports = require_xxx()（整体赋值）,
                    // cjs-module-lexer 静态分析拿不到命名导出,此时定位主入口的 __commonJS 块,
                    // 块内抓 exports.X = 形式,追加显式声明让 lexer 识别;
                    try {
                        const code = fs.readFileSync(outFile, 'utf8'),
                            m = code.match(/module\.exports\s*=\s*require_(\w+)\s*\(\s*\)\s*;?\s*$/m);
                        if (m) {
                            const fnName = m[1], startPat = 'var require_' + fnName + ' = __commonJS({',
                                start = code.indexOf(startPat);
                            if (start >= 0) {
                                let depth = 0, i = start + startPat.length - 1, end = -1;
                                while (i < code.length) {
                                    const ch = code[i];
                                    if (ch === '{') depth++;
                                    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
                                    i++;
                                }
                                if (end >= 0) {
                                    const block = code.substring(start, end + 1), keys = new Set(),
                                        re = /\bexports\d*\.([\p{ID_Start}$_][\p{ID_Continue}$]*)\s*=/gu;
                                    let mm;
                                    while ((mm = re.exec(block)) !== null) keys.add(mm[1]);
                                    if (keys.size > 0) {
                                        const decls = [...keys].map(k => `try { module.exports[${JSON.stringify(k)}] =
                                            module.exports[${JSON.stringify(k)}]; } catch {}`);
                                        fs.appendFileSync(outFile, '\n' + decls.join('\n') + '\n');
                                    }
                                }
                            }
                        }
                    } catch { }
                    newExports[e.key] = {
                        import: subpath(BUNDLED_DIR, outName), require: subpath(BUNDLED_DIR, outName),
                        default: subpath(BUNDLED_DIR, outName)
                    };
                }
            }

            if (!entryOk) {
                fs.rmSync(bundledDir, { recursive: true, force: true }), skipped++;
                continue;
            }

            // 保留通配符键和 package.json
            for (const w of parse.wildcards) if (j.exports && j.exports[w]) newExports[w] = j.exports[w];
            if (j.exports && j.exports[PKG_SUBPATH]) newExports[PKG_SUBPATH] = j.exports[PKG_SUBPATH];

            fs.writeFileSync(pj + '.orig', JSON.stringify(j));

            // 通配符覆盖路径保护
            const wildcardPrefixes = parse.wildcards.map(w => w.replace(DOT_SLASH_RE, '').replace(/\/\*.*$/, '/'))
                .filter(Boolean);

            j.exports = newExports;
            if (newExports['.'])
                j.main = isESM ? newExports['.'] : (newExports['.'].require || newExports['.'].default || newExports['.']);
            else delete j.main;
            if (isESM && j.main) j.module = j.main;
            // 删除安装期脚本字段：移动端 Gradle 会 npm rebuild，触发 postinstall；运行时无安装期，scripts 无用
            delete j.scripts;
            fs.writeFileSync(pj, JSON.stringify(j, null, 2));

            // 删除原 JS
            let deleted = 0;
            const resItems = resMap ? (resMap.get(pkgDir) || null) : null, resJsHits = resItems ? new Map() : null,
                walkDel = d => {
                    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                        if (f.isDirectory()) {
                            if (f.name === NM_DIR || f.name === BUNDLED_DIR) continue;
                            walkDel(path.join(d, f.name));
                        } else if (JS_RE.test(f.name)) {
                            const full = path.join(d, f.name), rel = toPosix(path.relative(pkgDir, full));
                            if (wildcardPrefixes.some(p => rel.startsWith(p))) continue;
                            if (resItems) {
                                const top = rel.split('/')[0];
                                if (resItems.has(top)) resJsHits.set(top, (resJsHits.get(top) || 0) + 1);
                            }
                            fs.unlinkSync(full); deleted++;
                        }
                    }
                };
            walkDel(pkgDir), totalDeleted += deleted, merged++;
            if (resJsHits && resJsHits.size > 0 && resLog)
                for (const [k, v] of resJsHits) resLog.push(`      ${relName}: ${k} (${v} 个 JS)`);
            if (process.env.OPTIMIZE_DEBUG) console.log(`  ✓ ${relName} (${parse.entries.length} 入口)`);
        }

        if (resLog && resLog.length > 0) {
            console.log('  处理保留的资源 JS（被引用则合并，否则删除）:');
            for (const line of resLog) console.log(line);
        }
        return { merged, skipped, totalDeleted };
    },
    // ==================== 清空资源 ====================
    collectReferencedFiles = nmRoot => {
        const refs = new Set(),
            walk = d => {
                for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                    const full = path.join(d, f.name);
                    if (f.isDirectory()) {
                        if (f.name === NM_DIR && d !== nmRoot) continue;
                        walk(full);
                    } else if (JS_RE.test(f.name)) {
                        let code;
                        try { code = fs.readFileSync(full, 'utf8'); } catch { continue; }
                        const re = /(?:from|require|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
                        let m;
                        while ((m = re.exec(code)) !== null) {
                            const abs = path.resolve(path.dirname(full), m[1]);
                            refs.add(abs);
                            if (!path.extname(abs))
                                for (const ext of ENTRY_EXTS) if (fs.existsSync(abs + ext)) refs.add(abs + ext);
                        }
                    }
                }
            };
        walk(nmRoot);
        return refs;
    },
    extractScript = cmd => {
        const m = cmd.match(SCRIPT_FILE_RE);
        return m ? m[1] : null;
    },
    extractResources = (pkgDir, scriptCode) => {
        const strings = new Set(), re = /['"`]([^\s'"`]{2,})['"`]/g;
        let m;
        while ((m = re.exec(scriptCode)) !== null) strings.add(m[1]);
        const items = [];
        for (const s of strings) {
            const first = s.split(/[\\/]/)[0];
            if (EXCLUDE_NAMES.has(first) || !first || first === '.' || first === '..') continue;
            if (fs.existsSync(path.join(pkgDir, first))) items.push(first);
        }
        return [...new Set(items)];
    },
    clearItem = (p, refs) => {
        let n = 0;
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            for (const f of fs.readdirSync(p)) {
                const full = path.join(p, f), sub = fs.statSync(full);
                if (sub.isDirectory()) n += clearItem(full, refs);
                else if (!JS_RE.test(f) && !refs.has(full)) try { fs.rmSync(full, { force: true }), n++; } catch { }
            }
        }
        else if (!JS_RE.test(path.basename(p)) && !refs.has(p)) fs.writeFileSync(p, ''), n++;
        return n;
    },
    clearResources = async (nmDir, excludePkgs) => {
        const refs = collectReferencedFiles(nmDir);
        let cleared = 0;
        for (const pj of findPkgJsons(nmDir)) {
            let j;
            try { j = JSON.parse(fs.readFileSync(pj, 'utf8')); } catch { continue; }
            if (!j.scripts) continue;
            const pkgDir = path.dirname(pj), pkgRel = toPosix(path.relative(nmDir, pkgDir));
            if (SKIP_PKGS.has(pkgRel) || excludePkgs.has(pkgRel)) continue;
            const pkgItems = [];
            for (const k of ['postinstall', 'preinstall', 'install', 'prepare']) {
                const cmd = j.scripts[k];
                if (!cmd) continue;
                const scriptRel = extractScript(cmd);
                if (!scriptRel) continue;
                const scriptAbs = path.resolve(pkgDir, scriptRel);
                if (!fs.existsSync(scriptAbs)) continue;
                const code = fs.readFileSync(scriptAbs, 'utf8'), items = extractResources(pkgDir, code);
                for (const item of items) {
                    const cnt = clearItem(path.join(pkgDir, item), refs);
                    if (cnt > 0) cleared += cnt, pkgItems.push(`${item}(${cnt})`);
                }
            }
            if (process.env.OPTIMIZE_DEBUG && pkgItems.length > 0) console.log(`  ✓ ${pkgRel}: ${pkgItems.join(', ')}`);
        }
        return cleared;
    },
    // ==================== 清平台 ====================
    prunePlatform = async (nmDir, myPlat, myArch) => {
        let removed = 0;
        const readHead = file => {
            let fd;
            try {
                fd = fs.openSync(file, 'r');
                const buf = Buffer.alloc(512), n = fs.readSync(fd, buf, 0, 512, 0);
                return n > 0 ? buf.subarray(0, n) : null;
            } catch {
                return null;
            } finally {
                if (fd !== undefined) fs.closeSync(fd);
            }
        },
            sniffPlat = buf => {
                if (!buf || buf.length < 4) return null;
                const hex = buf.toString('hex', 0, 4).toUpperCase();
                if (hex.startsWith('4D5A')) return 'win32';
                if (hex === '7F454C46') return 'linux';
                if (['CFFAEDFE', 'CEFAEDFE', 'FEEDFACE', 'FEEDFACF'].includes(hex)) return 'darwin';
                return null;
            },
            sniffArch = buf => {
                if (!buf || buf.length < 64) return null;
                const hex = buf.toString('hex', 0, 4).toUpperCase();
                try {
                    if (hex.startsWith('4D5A')) {
                        const off = buf.readUInt32LE(0x3C);
                        if (off + 6 > buf.length) return null;
                        const m = buf.readUInt16LE(off + 4);
                        return m === 0x8664 ? 'x64' : m === 0xAA64 ? 'arm64' : m === 0x14C ?
                            'ia32' : (m === 0x1C0 || m === 0x1C4) ? 'arm' : null;
                    }
                    if (hex === '7F454C46') {
                        const m = buf.readUInt16LE(0x12);
                        return m === 0x3E ? 'x64' : m === 0xB7 ? 'arm64' : m === 0x28 ? 'arm' : m === 0x03 ?
                            'ia32' : null;
                    }
                    if (hex === 'CFFAEDFE' || hex === 'CEFAEDFE') {
                        const c = buf.readUInt32LE(4);
                        return c === 0x01000007 ? 'x64' : c === 0x0100000C ? 'arm64' : c === 0x7 ? 'ia32' : c === 0xC ?
                            'arm' : null;
                    }
                    if (hex === 'FEEDFACF' || hex === 'FEEDFACE') {
                        const c = buf.readUInt32BE(4);
                        return c === 0x01000007 ? 'x64' : c === 0x0100000C ? 'arm64' : c === 0x7 ? 'ia32' : c === 0xC ?
                            'arm' : null;
                    }
                } catch { }
                return null;
            },
            suffixPlat = name => {
                const ext = path.extname(name).toLowerCase();
                if (ext === '.exe' || ext === '.dll') return 'win32';
                if (ext === '.dylib') return 'darwin';
                if (ext === '.so') return 'linux';
                return null;
            },
            delFile = p => {
                try { fs.unlinkSync(p), removed++; } catch { }
            },
            processDir = d => {
                let entries;
                try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    const full = path.join(d, e.name);
                    if (e.isDirectory()) { processDir(full); continue; }
                    if (JS_RE.test(e.name)) continue;
                    let plat = suffixPlat(e.name), arch = null;
                    const head = readHead(full);
                    if (head) {
                        if (!plat) plat = sniffPlat(head);
                        arch = sniffArch(head);
                    }
                    const platBad = plat && !myPlat.includes(plat), archBad = plat && arch && !myArch.includes(arch);
                    if (platBad || archBad) {
                        if (process.env.OPTIMIZE_DEBUG) {
                            const rel = toPosix(path.relative(nmDir, full));
                            console.log(`  ✓ ${rel} (${platBad ? '平台不符: ' + plat : '架构不符: ' + arch})`);
                        }
                        delFile(full);
                    }
                }
            };
        processDir(nmDir);
        return removed;
    },
    // ==================== 清开发文件 ====================
    pruneDevFiles = async (nmDir, nativePkgs) => {
        let deleted = 0;
        const PATTERNS = [
            /(^|\/)tsconfig\.json$/,
            /(^|\/)\.nycrc(\.(json|yml))?$/,
            /(^|\/)\.editorconfig$/, /(^|\/)\.prettierignore$/, /(^|\/)\.eslintignore$/,
            /(^|\/)\.dockerignore$/, /(^|\/)\.gitignore$/, /(^|\/)\.gitattributes$/, /(^|\/)\.npmignore$/,
            /\.(md|markdown)$/i, /\.(gyp|gypi)$/i, /\.(yml|yaml)$/i, /\.(h|c)$/,
            /\.d\.ts$/, /\.map$/, /metafile-.*\.json$/,
            /(^|\/)\.eslintrc(\.(json|yml|js|cjs))?$/, /(^|\/)\.babelrc(\.(json|js))?$/,
            /(^|\/)package-lock\.json$/, /(^|\/)\.package-lock\.json$/, /(^|\/)yarn\.lock$/,
            /(^|\/)package-support\.json$/,
        ], DIR_SKIP = new Set([BUNDLED_DIR]),
            COMPILE_EXTS = /\.(gyp|gypi|h|hh|hpp|c|cc|cpp|cxx|m|mm)$/i,
            inNativePkg = p => nativePkgs.some(nd => p.startsWith(nd + path.sep)),
            walk = d => {
                for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                    const full = path.join(d, f.name);
                    if (f.isDirectory()) {
                        if (DIR_SKIP.has(f.name)) continue;
                        if (f.name === '.github' || f.name === '.circleci') {
                            fs.rmSync(full, { recursive: true, force: true }), deleted++;
                            continue;
                        }
                        walk(full);
                    } else {
                        const rel = toPosix(path.relative(nmDir, full));
                        if (PATTERNS.some(re => re.test(rel)) && !(COMPILE_EXTS.test(f.name) && inNativePkg(full)))
                            try { fs.unlinkSync(full), deleted++; } catch { }
                    }
                }
            };
        walk(nmDir);
        return deleted;
    },
    pruneIntermediates = async nmDir => {
        let deleted = 0;
        const walk = d => {
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, f.name);
                if (f.isDirectory()) walk(full);
                else if (f.name.endsWith('.orig')) try { fs.unlinkSync(full), deleted++; } catch { }
            }
        };
        walk(nmDir);
        return deleted;
    },
    applyFilesRules = async nmDir => {
        let deleted = 0;
        // 1) 删顶层 node 假包（npm 上名为 node 的包,仅提供 node.exe,运行时不需要）
        const LICENSE_RE = /^licen[sc]e/i, TS_RE = /\.(ts|cts|mts)$/, nodePkg = path.join(nmDir, 'node');
        if (fs.existsSync(nodePkg)) try { fs.rmSync(nodePkg, { recursive: true, force: true }), deleted++; } catch { }

        // 2) 递归删 node-<platform>* 假包
        const walkForFakeNode = d => {
            let entries;
            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
            for (const f of entries) {
                if (!f.isDirectory()) continue;
                const full = path.join(d, f.name);
                if (/^node-(win|darwin|linux|freebsd|sunos|aix)/.test(f.name)) {
                    try { fs.rmSync(full, { recursive: true, force: true }), deleted++; } catch { }
                    continue;
                }
                walkForFakeNode(full);
            }
        };
        walkForFakeNode(nmDir);

        // 3) 删 license/licence 文件或目录 + .ts/.cts/.mts 文件
        const walk = d => {
            let entries;
            try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return }
            for (const f of entries) {
                const full = path.join(d, f.name);
                if (f.isDirectory()) {
                    if (f.name === BUNDLED_DIR) continue;
                    if (LICENSE_RE.test(f.name)) {
                        try { fs.rmSync(full, { recursive: true, force: true }), deleted++; } catch { }
                        continue;
                    }
                    walk(full);
                }
                else if (LICENSE_RE.test(f.name) || TS_RE.test(f.name)) try { fs.unlinkSync(full), deleted++; } catch { }
            }
        };
        walk(nmDir);

        const cleanEmpty = d => {
            for (const e of fs.readdirSync(d, { withFileTypes: true }))
                if (e.isDirectory()) cleanEmpty(path.join(d, e.name));
            if (d !== nmDir) try { if (fs.readdirSync(d).length === 0) fs.rmdirSync(d), deleted++; } catch { }
        };
        cleanEmpty(nmDir);
        return deleted;
    };

// ==================== 导出函数 ====================
/**
 * 清除快照中的 verified 标记（优化开始或构建失败时调用）
 * >查看定义:@see {@link clearVerified}
 * @param {string} snapshotDir 快照目录
 * @returns {Promise<void>}
 */
const clearVerified = async snapshotDir => {
    const p = path.join(snapshotDir, SNAPSHOT_FILE);
    if (!fs.existsSync(p)) return;
    try {
        const old = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (old.verified !== false) old.verified = false, fs.writeFileSync(p, JSON.stringify(old, null, 2));
    } catch { }
};
/**
 * 标记快照 verified=true（构建全流程成功后由 build.js / test.js 调用）
 * >查看定义:@see {@link markVerified}
 * @param {string} snapshotDir 快照目录
 * @returns {Promise<void>}
 */
const markVerified = async snapshotDir => {
    const p = path.join(snapshotDir, SNAPSHOT_FILE);
    if (!fs.existsSync(p)) return;
    try {
        const old = JSON.parse(fs.readFileSync(p, 'utf-8'));
        old.verified = true, fs.writeFileSync(p, JSON.stringify(old, null, 2));
    } catch { }
};
/**
 * 执行 node_modules 六阶段优化
 * >查看定义:@see {@link optimizeNodeModules}
 * @param {string} tempDir node_modules 所在目录（nodejs-assets/nodejs-project）
 * @param {object} [config] 优化配置
 * @param {string} [config.snapshotDir] 快照目录（默认同 tempDir）
 * @param {string} [config.targetPlatform] 目标平台：'android'（默认）或 'ios'
 * @param {string[]} [config.abiFilters] Android 目标架构（默认 ['arm64-v8a']）;iOS 固定保留 arm64 + x64
 * @param {string} config.runtimeMajor 运行时 Node 主版本号（必填,从 libnode/node_version.h 读取）
 * @param {string[]} [config.exclude] 排除的包名列表
 * @returns {Promise<object>} 各阶段统计（merged / cleared / platform / devFiles / intermediates / filesRules）
 */
const optimizeNodeModules = async (tempDir, config = {}) => {
    const targetPlatform = config.targetPlatform || 'android', abiFilters = config.abiFilters || ['arm64-v8a'],
        runtimeMajor = config.runtimeMajor, excludePkgs = new Set(config.exclude || []),
        nmDir = path.join(tempDir, NM_DIR), snapshotDir = config.snapshotDir || tempDir,
        snapPath = path.join(snapshotDir, SNAPSHOT_FILE), myPlat = TARGET_PLAT_MAP[targetPlatform] || [],
        myArch = targetPlatform === 'ios' ? IOS_ARCHES : (abiFilters || []).map(a => ABI_ARCH_MAP[a]).filter(Boolean);

    if (!runtimeMajor) throw new Error('optimizeNodeModules 缺少 config.runtimeMajor（应从 libnode/node_version.h 读取）');
    if (!fs.existsSync(nmDir)) {
        console.log('[优化] node_modules 不存在,跳过');
        return { skipped: true };
    }

    await clearVerified(snapshotDir);  // 执行优化前清 verified,构建成功后再由 build.js / test.js 写回 true
    const t0 = Date.now(), nativePkgs = findPackages(nmDir).filter(p => fs.existsSync(path.join(p, 'binding.gyp')));
    try {
        // 阶段1: 清空资源（跳过 js，留待合并阶段处理）
        console.log('  [1/6] 清空复制到项目根的资源...');
        const c = await clearResources(nmDir, excludePkgs);
        console.log(`    清空 ${c} 个文件（js 文件保留，留待合并阶段处理）`);

        // 阶段2: 合并
        console.log('  [2/6] 合并 JS...');
        const m = await mergeAll(nmDir, excludePkgs, runtimeMajor);
        console.log(`    合并 ${m.merged} 包,跳过 ${m.skipped},删 ${m.totalDeleted} 个 JS`);

        // 阶段3: 清平台二进制
        console.log('  [3/6] 清理非当前平台二进制...');
        const p = await prunePlatform(nmDir, myPlat, myArch);
        console.log(`    清理 ${p} 项`);

        // 阶段4: 清开发文件
        console.log('  [4/6] 清理开发文件...');
        const d = await pruneDevFiles(nmDir, nativePkgs);
        console.log(`    清理 ${d} 个文件`);

        // 阶段5: 清中间产物
        console.log('  [5/6] 清理中间产物...');
        const i = await pruneIntermediates(nmDir);
        console.log(`    清理 ${i} 个文件`);

        // 阶段6: 清除不参与运行的文件（与 build.js 的 files 数组对齐）
        console.log('  [6/6] 清除不参与运行的文件和空目录...');
        const fr = await applyFilesRules(nmDir);
        console.log(`    清理 ${fr} 项`);

        // 写 platform/abiFilters/runtimeMajor,同时 verified=false
        await writeSnapshotFlags(snapshotDir, targetPlatform, abiFilters, runtimeMajor);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`[信息] 优化完成,耗时 ${elapsed}s`);

        return { merged: m.merged, cleared: c, platform: p, devFiles: d, intermediates: i, filesRules: fr };
    } catch (err) {
        // 失败时删除依赖快照,下次强制重装 + 重优化
        try { fs.rmSync(snapPath, { recursive: true, force: true }); } catch { }
        throw err;
    }
};
/**
 * 当前优化文件的 SHA256 前 16 位（缓存指纹:优化代码一改,缓存自动失效）
 * >查看定义:@see {@link SELF_HASH}
 */
const SELF_HASH = (() => {
    try {
        const src = fs.readFileSync(new URL(import.meta.url), 'utf8');
        return require('crypto').createHash('sha256').update(src).digest('hex').slice(0, 16);
    } catch { return 'unknown'; }
})();

export { clearVerified, markVerified, optimizeNodeModules, SELF_HASH };