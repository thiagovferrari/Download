const app = require('./api/index');
const PORT = 3000;

app.listen(PORT, () => {
  console.log('\n  ╭─────────────────────────────────╮');
  console.log(`  │   Lon Download                  │`);
  console.log(`  │   http://localhost:${PORT}          │`);
  console.log('  ╰─────────────────────────────────╯\n');
});
