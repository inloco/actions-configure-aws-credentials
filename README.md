# Configure AWS Credentials Action

## Example

```yaml
jobs:
  example:
    steps:
      - uses: inloco/actions-configure-aws-credentials@HEAD
        id: aws-credentials
        with:
          aws-region: us-east-1
          role-to-assume: arn:aws:iam::000000000000:role/example
      - env:
          AWS_ACCESS_KEY_ID: ${{ steps.aws-credentials.outputs.aws-access-key-id }}
          AWS_SECRET_ACCESS_KEY: ${{ steps.aws-credentials.outputs.aws-secret-access-key }}
          AWS_SESSION_TOKEN: ${{ steps.aws-credentials.outputs.aws-session-token }}
        run: aws sts get-caller-identity
```
