const sgMail = require("@sendgrid/mail");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (to, subject, text) => {
  try {
    await sgMail.send({
      to,
      from: process.env.EMAIL_FROM,
      subject,
      text,
    });
    console.log("Email sent ✅");
  } catch (error) {
    console.error(error.response?.body || error.message);
  }
};

module.exports =  sendEmail ;
