FROM node:22

# Install Nginx and supervisor
RUN apt-get update && apt-get install -y nginx supervisor gettext-base && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install required Node.js packages
RUN npm install -g @tiangong-lca/mcp-server supergateway

# Copy Nginx default configuration
COPY docker/default.template /etc/nginx/templates/defualt.template

# Setup supervisor configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose ports
EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]