async function seed() {
  console.log("Report sections have been removed from this project.");
  console.log("Wiki knowledge base is now built exclusively from uploaded PDFs via the contributor portal.");
  console.log("Nothing to seed.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
