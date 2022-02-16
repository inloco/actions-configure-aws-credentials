const core = require('@actions/core');
const aws = require('aws-sdk');
const assert = require('assert');

// The max time that a GitHub action is allowed to run is 6 hours.
// That seems like a reasonable default to use if no role duration is defined.
const DEFAULT_ROLE_DURATION_FOR_OIDC_ROLES = 3600;
const ROLE_SESSION_NAME = 'GitHubActions';

async function assumeRole(params) {
  // Assume a role to get short-lived credentials using longer-lived credentials.
  const isDefined = i => !!i;

  const {
    region,
    roleToAssume,
    roleSessionName,
    roleDurationSeconds,
    webIdentityToken
  } = params;
  assert(
      [region, roleToAssume, roleSessionName, roleDurationSeconds].every(isDefined),
      "Missing required input when assuming a Role."
  );

  const {GITHUB_REPOSITORY, GITHUB_WORKFLOW, GITHUB_ACTION, GITHUB_ACTOR, GITHUB_SHA} = process.env;
  assert(
      [GITHUB_REPOSITORY, GITHUB_WORKFLOW, GITHUB_ACTION, GITHUB_ACTOR, GITHUB_SHA].every(isDefined),
      'Missing required environment value. Are you running in GitHub Actions?'
  );

  const sts = getStsClient(region);

  const assumeRoleRequest = {
    RoleArn: roleToAssume,
    RoleSessionName: roleSessionName,
    DurationSeconds: roleDurationSeconds,
    WebIdentityToken: webIdentityToken,
  };

  return sts.assumeRoleWithWebIdentity(assumeRoleRequest)
    .promise()
    .then(function (data) {
      return {
        accessKeyId: data.Credentials.AccessKeyId,
        secretAccessKey: data.Credentials.SecretAccessKey,
        sessionToken: data.Credentials.SessionToken,
        assumedRoleId: data.AssumedRoleUser.AssumedRoleId,
      };
    });
}

async function getAccountId(region) {
  const sts = getStsClient(region);
  const identity = await sts.getCallerIdentity().promise();
  return identity.Account;
}

function reloadCredentials() {
  // Force the SDK to re-resolve credentials with the default provider chain.
  //
  // This action typically sets credentials in the environment via environment variables.
  // The SDK never refreshes those env-var-based credentials after initial load.
  // In case there were already env-var creds set in the actions environment when this action
  // loaded, this action needs to refresh the SDK creds after overwriting those environment variables.
  //
  // The credentials object needs to be entirely recreated (instead of simply refreshed),
  // because the credential object type could change when this action writes env var creds.
  // For example, the first load could return EC2 instance metadata credentials
  // in a self-hosted runner, and the second load could return environment credentials
  // from an assume-role call in this action.
  aws.config.credentials = null;

  return new Promise((resolve, reject) => {
    aws.config.getCredentials((err) => {
      if (err) {
        reject(err);
      }
      resolve();
    })
  });
}

function getStsClient(region) {
  return new aws.STS({
    region,
    stsRegionalEndpoints: 'regional',
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// retryAndBackoff retries with exponential backoff the promise upto maxRetries time.
const retryAndBackoff = async (fn, retries = 0, maxRetries = 12, base = 50) => {
  try {
    return await fn();
  } catch (err) {
    // It's retryable, so sleep and retry.
    await sleep(Math.random() * (Math.pow(2, retries) * base));
    if (++retries === maxRetries) {
      throw err;
    }
    return await retryAndBackoff(fn, retries, maxRetries, base);
  }
}

async function run() {
  try {
    const region = core.getInput('aws-region', { required: true });
    const roleToAssume = core.getInput('role-to-assume', { required: true });
    const roleSessionName = core.getInput('role-session-name', { required: false }) || ROLE_SESSION_NAME;
    const roleDurationSeconds = core.getInput('role-duration-seconds', { required: false }) || DEFAULT_ROLE_DURATION_FOR_OIDC_ROLES;

    core.debug("Getting ID token");
    const webIdentityToken = await core.getIDToken('sts.amazonaws.com');

    core.debug("Assuming role");
    const roleCredentials = await retryAndBackoff(
      async () => {
        return await assumeRole({
          region,
          roleToAssume,
          roleSessionName,
          roleDurationSeconds,
          webIdentityToken
        })
      }
    );

    const {accessKeyId, secretAccessKey, sessionToken, assumedRoleId} = roleCredentials;

    core.setSecret(accessKeyId);
    core.setSecret(secretAccessKey);
    core.setSecret(sessionToken);

    core.setOutput('aws-access-key-id', accessKeyId);
    core.setOutput('aws-secret-access-key', secretAccessKey);
    core.setOutput('aws-session-token', sessionToken);
    core.setOutput('aws-role-id', assumedRoleId);

    process.env.AWS_ACCESS_KEY_ID = accessKeyId;
    process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
    process.env.AWS_SESSION_TOKEN = sessionToken;
    await reloadCredentials();

    const accountId = await getAccountId(region);
    core.setOutput('aws-account-id', accountId);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run();
