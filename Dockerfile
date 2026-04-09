FROM nginx:alpine

# Copy the static website files to the nginx html directory
COPY . /usr/share/nginx/html

# Expose port 80
EXPOSE 80
