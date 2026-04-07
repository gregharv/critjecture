export function splitCsvRecord(record: string, delimiter = ",") {
  const parsedCells: string[] = [];
  let currentCell = "";
  let inQuotedCell = false;
  let atCellStart = true;

  for (let index = 0; index < record.length; index += 1) {
    const currentChar = record[index];

    if (inQuotedCell) {
      if (currentChar === '"') {
        if (record[index + 1] === '"') {
          currentCell += '"';
          index += 1;
          continue;
        }

        inQuotedCell = false;
        continue;
      }

      currentCell += currentChar;
      atCellStart = false;
      continue;
    }

    if (currentChar === delimiter) {
      parsedCells.push(currentCell);
      currentCell = "";
      atCellStart = true;
      continue;
    }

    if (currentChar === "\n" || currentChar === "\r") {
      if (currentChar === "\r" && record[index + 1] === "\n") {
        index += 1;
      }
      break;
    }

    if (atCellStart && currentChar === '"') {
      inQuotedCell = true;
      atCellStart = false;
      continue;
    }

    currentCell += currentChar;
    atCellStart = false;
  }

  parsedCells.push(currentCell);

  if (parsedCells[0]?.charCodeAt(0) === 0xfeff) {
    parsedCells[0] = parsedCells[0].slice(1);
  }

  return parsedCells;
}

export function countCsvDelimiters(record: string, delimiter = ",") {
  if (!record) {
    return 0;
  }

  return Math.max(0, splitCsvRecord(record, delimiter).length - 1);
}
