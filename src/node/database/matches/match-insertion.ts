import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import { glob } from 'csdm/node/filesystem/glob';
import type { DatabaseSettings } from 'csdm/node/settings/settings';
import type { Database } from 'csdm/node/database/schema';
import { executePsql } from 'csdm/node/database/psql/execute-psql';
import { formatHostnameForUri } from 'csdm/node/database/format-hostname-for-uri';

export type InsertOptions = {
  databaseSettings: DatabaseSettings;
  outputFolderPath: string;
  demoName: string;
};

export function getOutputFolderPath() {
  return path.resolve(os.tmpdir(), 'cs-demo-manager');
}

export function getDemoNameFromPath(demoPath: string) {
  return path.parse(demoPath).name;
}

export function getCsvFilePath(outputFolderPath: string, demoName: string, csvFileSuffix: string) {
  return path.resolve(outputFolderPath, `${demoName}${csvFileSuffix}`);
}

type InsertFromCsvOptions<Table> = {
  databaseSettings: DatabaseSettings;
  csvFilePath: string;
  tableName: keyof Database;
  columns: Array<keyof Table>;
};

export async function insertFromCsv<Table>({
  columns,
  csvFilePath,
  databaseSettings,
  tableName,
}: InsertFromCsvOptions<Table>) {
  const { database, username, hostname, port, password } = databaseSettings;
  const columnNames = columns.join(',');
  const escapedCsvFilePath = csvFilePath.replaceAll("'", "''");
  const command = `-c "\\copy ${tableName}(${columnNames}) FROM '${escapedCsvFilePath}' ENCODING 'UTF8' CSV DELIMITER ','" "postgresql://${username}:${encodeURIComponent(
    password,
  )}@${formatHostnameForUri(hostname)}:${port}/${database}"`;
  await executePsql(command);
}

export async function deleteCsvFilesInOutputFolder(outputFolderPath: string) {
  const files = await glob('*.csv', {
    cwd: outputFolderPath,
    absolute: true,
  });

  await Promise.all(files.map((csvFile) => fs.remove(csvFile)));
}

/**
 * Fixes invalid dates in the match CSV file that may occur after CS2 updates.
 * The demo analyzer may output "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN" for corrupted dates.
 * This function replaces invalid dates with the current timestamp.
 */
export async function fixInvalidMatchDates(csvFilePath: string): Promise<void> {
  try {
    const content = await fs.readFile(csvFilePath, 'utf-8');
    const lines = content.split('\n');
    
    if (lines.length === 0) {
      return;
    }
    
    // Find the date column index from the header
    const headerLine = lines[0];
    const headers = headerLine.split(',');
    const dateColumnIndex = headers.findIndex(h => h.trim() === 'date');
    
    if (dateColumnIndex === -1) {
      return;
    }
    
    // Check each data line for invalid dates
    const fallbackDate = new Date().toISOString();
    let hasInvalidDate = false;
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      const columns = line.split(',');
      if (columns.length > dateColumnIndex) {
        const dateValue = columns[dateColumnIndex];
        // Check if date is invalid (contains NaN or is not a valid ISO date)
        if (dateValue.includes('NaN') || !isValidISODate(dateValue)) {
          columns[dateColumnIndex] = fallbackDate;
          lines[i] = columns.join(',');
          hasInvalidDate = true;
        }
      }
    }
    
    // Write back if we made changes
    if (hasInvalidDate) {
      await fs.writeFile(csvFilePath, lines.join('\n'), 'utf-8');
    }
  } catch (error) {
    // If we can't fix the dates, log but don't throw - let the insertion fail naturally
    // so we don't mask other issues
    logger.error('Error while fixing invalid dates in match CSV:', error);
  }
}

/**
 * Checks if a string is a valid ISO date.
 */
function isValidISODate(dateString: string): boolean {
  if (!dateString || dateString.trim() === '') return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}
