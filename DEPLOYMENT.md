# Deployment Guide for Render

This guide will walk you through deploying your Branded UK E-commerce Backend API to Render.

## Prerequisites

1. A GitHub account
2. Your code pushed to a GitHub repository
3. A Render account (sign up at [render.com](https://render.com))

## Step-by-Step Deployment

### Step 1: Push Your Code to GitHub

If you haven't already, push your code to a GitHub repository:

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Ready for Render deployment"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push to GitHub
git push -u origin main
```

### Step 2: Create a PostgreSQL Database on Render

1. Log in to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"PostgreSQL"**
3. Configure your database:
   - **Name**: `brandeduk-db` (or any name you prefer)
   - **Database**: `brandeduk`
   - **User**: `brandeduk_user`
   - **Region**: `Oregon` (or match your web service region)
   - **Plan**: Choose based on your needs (Free tier available)
4. Click **"Create Database"**
5. **Important**: Copy the **Internal Database URL** or individual connection details:
   - Host
   - Port
   - Database name
   - User
   - Password

### Step 3: Deploy Your Web Service

#### Option A: Using render.yaml (Recommended)

1. In Render Dashboard, click **"New +"** → **"Blueprint"**
2. Connect your GitHub repository
3. Render will automatically detect the `render.yaml` file
4. Review the configuration and click **"Apply"**
5. Render will create the web service automatically

#### Option B: Manual Setup

1. In Render Dashboard, click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Configure the service:
   - **Name**: `branded-uk-backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Starter` (or Free tier)

### Step 4: Configure Environment Variables

In your Render web service dashboard:

1. Go to **"Environment"** tab
2. Add/verify the following environment variables:

```
NODE_ENV=production
PORT=10000
DB_HOST=your-database-host-from-step-2
DB_PORT=5432
DB_NAME=brandeduk
DB_USER=brandeduk_user
DB_PASSWORD=your-database-password-from-step-2
DB_SSL=true
DB_POOL_MAX=50
DB_POOL_MIN=5
CORS_ORIGIN=*
```

**Important Notes:**
- `DB_PASSWORD` should be set from your PostgreSQL database credentials
- `PORT` will be automatically set by Render, but you can specify 10000
- Update `CORS_ORIGIN` with your frontend domain when ready (e.g., `https://yourfrontend.com`)

### Step 5: Update render.yaml (if needed)

If you created the database manually, update the `render.yaml` file with your actual database connection details:

```yaml
- key: DB_HOST
  value: your-actual-db-host
- key: DB_NAME
  value: your-actual-db-name
- key: DB_USER
  value: your-actual-db-user
```

Then commit and push:
```bash
git add render.yaml
git commit -m "Update database connection details"
git push
```

### Step 6: Deploy and Verify

1. Render will automatically start building and deploying your service
2. Monitor the **"Logs"** tab for build progress
3. Once deployed, your service will be available at:
   - `https://branded-uk-backend.onrender.com` (or your custom domain)
4. Test your API:
   - Health check: `https://your-service.onrender.com/health`
   - Products API: `https://your-service.onrender.com/api/products`

### Step 7: Set Up Custom Domain (Optional)

1. In your web service dashboard, go to **"Settings"**
2. Scroll to **"Custom Domains"**
3. Add your domain and follow DNS configuration instructions

## Health Check Endpoints

Your API includes health check endpoints that Render can use:

- **Liveness**: `/health/live` - Simple alive check
- **Readiness**: `/health/ready` - Checks database connectivity
- **Full Health**: `/health` - Complete health status with database info

## Troubleshooting

### Build Fails

- Check the **"Logs"** tab for error messages
- Ensure `package.json` has all required dependencies
- Verify Node.js version compatibility

### Database Connection Issues

- Verify all database environment variables are set correctly
- Check that `DB_SSL=true` is set (required for Render PostgreSQL)
- Ensure your database is in the same region as your web service
- Check database connection limits in your plan

### Service Won't Start

- Check logs for port binding errors
- Verify `PORT` environment variable is set
- Ensure `npm start` command works locally

### CORS Issues

- Update `CORS_ORIGIN` environment variable with your frontend domain
- For development, you can temporarily use `*` (not recommended for production)

## Monitoring

- **Logs**: View real-time logs in the Render dashboard
- **Metrics**: Monitor CPU, memory, and request metrics
- **Health Checks**: Render automatically monitors `/health/live` endpoint

## Auto-Deploy

Render automatically deploys when you push to your connected branch (usually `main` or `master`). You can:
- Disable auto-deploy in service settings
- Set up manual deploys only
- Configure branch-specific deployments

## Cost Considerations

- **Free Tier**: Includes 750 hours/month, services spin down after 15 minutes of inactivity
- **Starter Plan**: $7/month - Always on, better performance
- **PostgreSQL**: Free tier available with limitations

## Next Steps

1. Set up your frontend to connect to the deployed API
2. Update `CORS_ORIGIN` with your frontend domain
3. Consider setting up a custom domain
4. Monitor performance and scale as needed
5. Set up database backups (available in paid plans)

## Support

- Render Documentation: https://render.com/docs
- Render Community: https://community.render.com
- Check your service logs for specific error messages


