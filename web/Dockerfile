# Chamber marketing site: static files behind nginx.
#
# Railway builds this (see railway.toml) and injects PORT; the official nginx
# image runs envsubst over /etc/nginx/templates/*.template at start-up, which
# is how ${PORT} reaches the listen directive. Locally, docker-compose.yml
# bind-mounts the folder into a plain nginx instead so edits show on refresh.
FROM nginx:1.27-alpine

ENV PORT=8080

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY . /usr/share/nginx/html

# Keep deploy plumbing out of the served tree.
RUN rm -f /usr/share/nginx/html/Dockerfile \
          /usr/share/nginx/html/nginx.conf.template \
          /usr/share/nginx/html/railway.toml \
          /usr/share/nginx/html/docker-compose.yml \
          /usr/share/nginx/html/.dockerignore

EXPOSE 8080
