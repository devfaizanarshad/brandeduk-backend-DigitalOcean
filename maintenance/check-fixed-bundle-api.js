const { closePool } = require('../config/database');
const { getBundle, listBundles } = require('../services/fixedBundleService');

async function checkFixedBundleApi() {
  const adminList = await listBundles({ admin: true, limit: 1 });
  const publicList = await listBundles({ limit: 1 });
  const sample = adminList.bundles[0]
    ? await getBundle(adminList.bundles[0].id, { admin: true })
    : null;
  const result = {
    valid: adminList.total === 94 && publicList.total === 94 && Boolean(sample?.components.length),
    adminBundleCount: adminList.total,
    publicBundleCount: publicList.total,
    sampleBundle: sample?.name || null,
    sampleComponentCount: sample?.components.length || 0,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

checkFixedBundleApi()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
