# @growthbook/remote-saved-groups-csv-parser

Parses and validates the CSV files behind GrowthBook [Remote Saved Groups](https://docs.growthbook.io/features/remote-saved-groups). GrowthBook uses it to check uploads, and the GrowthBook Proxy's loader uses it to read files into Redis. Use it if you write your own loader, so your files are read and your IDs are stored the same way.

It has no dependencies and works in Node.js 18+ and browsers with the use of a bundler.

```bash
npm install @growthbook/remote-saved-groups-csv-parser
```

## File format

- One ID per line. Blank lines are skipped.
- A first line equal to the group's attribute (such as `id`) is a header and is skipped.
- An ID may be in double quotes. A line with more than one column (`,`, `;` or a tab outside quotes) is invalid.
- IDs are at most 1,024 characters (`MAX_ID_LENGTH`).
- For a number attribute, every ID must be a number. Numbers are stored in their shortest form, so `001`, `1.0` and `1e0` are all stored as `1`.
- The file must be UTF-8 text. A byte order mark and Windows line endings are fine. Spreadsheets (`.xlsx`) and zip files are rejected.

## Reading a file

`parseRemoteGroupCsv` reads a whole file from any stream of byte chunks, such as a file stream or a `fetch` response body. Memory use is bounded by one line, so it handles large files. `onId` is called with each valid ID, in the form to store and look up.

```ts
import { createReadStream } from "fs";
import { parseRemoteGroupCsv } from "@growthbook/remote-saved-groups-csv-parser";

const ids: string[] = [];
const result = await parseRemoteGroupCsv(createReadStream("group.csv"), {
  attributeKey: "id",
  numeric: false,
  onId: (id) => ids.push(id),
});

if (result.type === "valid") {
  console.log(`${result.idCount} IDs`);
} else {
  console.log(`${result.invalidLineCount} invalid lines`, result.errors);
}
```

Any invalid line makes the whole file invalid, so only use the IDs from a `valid` result. `errors` lists the first 10 problems (`MAX_ERRORS`).

To feed chunks yourself, use `RemoteGroupCsvParser`: call `push(chunk)` for each chunk, then `end()` for the result. Stop early when `stopped` is true, which means the file isn't text.

## Looking up IDs

Store each ID as `onId` gives it. When looking up a user, convert the attribute value with `toRemoteGroupKey`, so number attributes match:

```ts
import { toRemoteGroupKey } from "@growthbook/remote-saved-groups-csv-parser";

toRemoteGroupKey("001", true); // "1"
toRemoteGroupKey("abc", false); // "abc"
```

## Checking part of a file

`checkRemoteGroupCsvSample` checks a slice of a file without reading the rest, for a quick check before uploading. Pass `start` and `end` to say whether the slice begins or ends the file. It throws on the first problem and returns how many IDs the slice has.

## License

MIT
