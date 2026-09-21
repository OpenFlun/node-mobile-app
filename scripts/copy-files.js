import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 要复制的文件位置和文件目标位置
const __filename = fileURLToPath(import.meta.url), __dirname = path.dirname(__filename),
    initCwd = process.env.INIT_CWD, fileName = 'mobileAppConfig.js', targetDir = initCwd ? path.resolve(initCwd) : '',
    // 要拷贝的文件和目标文件路径
    sourceFile = path.join(__dirname, '..', fileName), targetFile = path.join(targetDir, fileName);

/**
 * 复制文件到项目根目录
 * >查看定义:@see {@link copyFile}
 * @returns {boolean} - 复制是否成功
 */
const copyFile = () => {
    console.log(`🔍 检查 ${fileName} 文件...`), console.log(`📁 项目根目录:${targetDir}`);
    try {
        // 无 INIT_CWD（非用户项目安装场景）|| 目标目录不是 Node 项目 || 包自身的 npm install（开发调试）→ 跳过
        if (!targetDir) return true;
        if (!fs.existsSync(path.join(targetDir, 'package.json'))) return true;
        if (targetDir === path.resolve(__dirname, '..')) return true;
        if (fs.existsSync(targetFile)) return true; // 目标文件已存在 → 直接返回
        console.log(`⚠️ 在项目根目录未找到 ${fileName} 文件，正在创建...`);

        fs.copyFileSync(sourceFile, targetFile);     // 复制源文件到项目根目录
        console.log(`✓ 已创建 ${fileName} 示例文件:${targetFile}`);
        return true;
    } catch (error) {
        console.error(`✗ 创建 ${fileName} 文件失败:`, error.message);
        return false;
    }
}

// 执行脚本并导出函数
if (process.argv[1] === __filename) copyFile();
export { copyFile };