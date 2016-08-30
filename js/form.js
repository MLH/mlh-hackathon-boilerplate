var typeform_url = "https://majorleaguehacking.typeform.com/to/bBZ69R";

var formFill = function() {
  var accessToken = getAccessToken(),
      request_url = "https://my.mlh.io/api/v1/user";

  if (hasAccessToken()) {
    request_url += "?access_token=" + accessToken;

    $.get(request_url, function(response, status) {
      console.log(response.data);
      redirectPage(response.data);
    });
  }
};

var redirectPage = function(data) {
  var fields = ['first_name', 'last_name', 'email', 'graduation', 'major', 'shirt_size', 'dietary_restrictions', 'special_needs', 'date_of_birth', 'gender', 'phone_number', 'school'];
  
  for (var x in fields){
    var field = fields[x];

    typeform_url += (x > 0) ? '&' : '?';

    if (field === 'school')
      data[field] = data[field]['name'];

    typeform_url += field + '=' + data[field];
  }
  console.log(typeform_url);
  window.location.href = typeform_url;
}

var getAccessToken = function() {
  var access_token;

  if (hasAccessToken()) {
    access_token = window.location.href.split(/[&#]/)[1].replace('access_token=', '');
  }

  console.log(access_token);
  return access_token;
};

var hasAccessToken = function() {
  return (window.location.href.indexOf('access_token') != -1);
}

formFill();