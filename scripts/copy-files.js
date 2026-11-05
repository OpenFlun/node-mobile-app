import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

// 要复制的文件位置、目标目录和目标文件路径
const __filename = fileURLToPath(import.meta.url), __dirname = path.dirname(__filename),
    fileName = 'mobileAppConfig.js', sourceFile = path.join(__dirname, '..', fileName),
    targetDir = path.resolve(process.env.INIT_CWD || process.cwd()), targetFile = path.join(targetDir, fileName);

/**
 * 复制配置文件到项目根目录
 * @returns {boolean} - 复制是否成功
 */
const copyFile = () => {
    console.log(chalk.gray('项目根目录: ') + targetDir);
    try {
        // 目标目录不是 Node 项目 || 包自身的 npm install(开发调试)→ 跳过
        if (!fs.existsSync(path.join(targetDir, 'package.json'))) return true;
        if (targetDir === path.resolve(__dirname, '..')) return true;
        if (fs.existsSync(targetFile)) {
            console.log(chalk.green('✓ ') + chalk.greenBright('已存在: ') + chalk.gray(targetFile));
            return true;
        }
        console.log(chalk.cyan('· ') + `未找到 ${fileName},正在创建...`);
        fs.copyFileSync(sourceFile, targetFile);
        console.log(chalk.green('✓ ') + chalk.greenBright(`已生成 ${fileName}: `) + chalk.gray(targetFile));
        return true;
    } catch (error) {
        console.error(chalk.red('✗ ') + `创建 ${fileName} 失败: ` + error.message);
        return false;
    }
};

if (process.argv[1] === __filename) copyFile();
export { copyFile };