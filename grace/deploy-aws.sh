#!/bin/bash
# GRACE — one-shot EC2 deploy (ap-southeast-1).
# Run:  bash grace/deploy-aws.sh
# Uses the SSO temp credentials already in ~/.aws/credentials.
set -euo pipefail
export AWS_PROFILE=688060218394_AdministratorAccess AWS_DEFAULT_REGION=ap-southeast-1

PRESIGNED=$(cat /tmp/presigned-url.txt)

echo "→ security group"
VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name grace-web --description "GRACE demo http" \
      --vpc-id "$VPC" --query GroupId --output text 2>/dev/null \
  || aws ec2 describe-security-groups --filters Name=group-name,Values=grace-web Name=vpc-id,Values="$VPC" \
      --query 'SecurityGroups[0].GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 2>/dev/null || true
echo "  $SG"

echo "→ user-data"
cat > /tmp/grace-userdata.sh <<USERDATA
#!/bin/bash
set -ex
exec > /var/log/grace-init.log 2>&1
dnf install -y nodejs22 npm22 2>/dev/null || dnf install -y nodejs20 npm20 2>/dev/null || dnf install -y nodejs npm
NODEBIN=\$(command -v node-22 || command -v node-20 || command -v node)
NPMBIN=\$(command -v npm-22 || command -v npm-20 || command -v npm)
ln -sf "\$NODEBIN" /usr/local/bin/node
mkdir -p /opt/grace-app && cd /opt/grace-app
curl -fsSL -o grace.tar.gz '$PRESIGNED'
tar xzf grace.tar.gz && rm grace.tar.gz
"\$NPMBIN" install --omit=dev
TOKEN=\$(curl -sX PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
PUBIP=\$(curl -s -H "X-aws-ec2-metadata-token: \$TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
cat > /etc/systemd/system/grace.service <<UNIT
[Unit]
Description=GRACE merchant
After=network.target
[Service]
WorkingDirectory=/opt/grace-app
Environment=PORT=80
Environment=PUBLIC_URL=http://\$PUBIP
Environment=GRACE_NETWORK=mainnet
Environment=GRACE_WINDOW=90
ExecStart=/usr/local/bin/node grace/server.mjs
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now grace
USERDATA

echo "→ AMI"
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
       --query Parameter.Value --output text)
echo "  $AMI"

echo "→ launch t3.small"
ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.small \
      --security-group-ids "$SG" --user-data file:///tmp/grace-userdata.sh \
      --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=grace-merchant}]' \
      --query 'Instances[0].InstanceId' --output text)
echo "  $ID"
aws ec2 wait instance-running --instance-ids "$ID"
IP=$(aws ec2 describe-instances --instance-ids "$ID" \
      --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

echo ""
echo "============================================"
echo "  instance: $ID"
echo "  URL:      http://$IP"
echo "  console:  http://$IP/console"
echo "============================================"
echo "$IP" > /tmp/grace-ip.txt
echo "(boot takes ~2 min; then Claude takes over — funding + verification)"
