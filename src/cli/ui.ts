import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export const ui = {
  info(msg: string) {
    console.log(chalk.blue('ℹ'), msg);
  },
  success(msg: string) {
    console.log(chalk.green('✅'), msg);
  },
  warn(msg: string) {
    console.log(chalk.yellow('⚠️'), msg);
  },
  error(msg: string) {
    console.error(chalk.red('❌'), msg);
  },
  spin(msg: string): Ora {
    return ora(msg).start();
  },
  table(rows: Record<string, string>[]) {
    if (rows.length === 0) {
      console.log(chalk.gray('  (无数据)'));
      return;
    }
    console.table(rows);
  },
};
