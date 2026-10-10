// Checks content/ for broken references and misplaced private material.
// Run: node scripts/validate.ts   (exit code 1 on errors; warnings are printed but do not fail)
import { loadContent, printIssues } from './lib/load.ts';

const content = loadContent();
const { errors, warnings } = printIssues(content.issues);
const listed = Object.values(content.companies).filter((c) => c.listing === 'listed').length;
console.log(
  `validate: ${content.layers.length} layers, ${content.nodes.size} nodes, ${Object.keys(content.companies).length} companies (${listed} listed), ` +
    `${content.reports.length} reports, ${content.news.length} news, ${content.records.length} records — ${errors} error(s), ${warnings} warning(s)`,
);
process.exit(errors ? 1 : 0);
