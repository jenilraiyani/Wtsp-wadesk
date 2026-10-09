USE WhatsAppPanel;
GO

IF COL_LENGTH('dbo.Users', 'Email') IS NULL
    ALTER TABLE dbo.Users ADD Email NVARCHAR(180) NULL;
GO

IF COL_LENGTH('dbo.Users', 'GoogleId') IS NULL
    ALTER TABLE dbo.Users ADD GoogleId NVARCHAR(80) NULL;
GO

IF COL_LENGTH('dbo.Users', 'AuthProvider') IS NULL
    ALTER TABLE dbo.Users ADD AuthProvider NVARCHAR(20) NOT NULL CONSTRAINT DF_Users_AuthProvider DEFAULT 'local';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_Email')
    CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users (Email) WHERE Email IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Users_GoogleId')
    CREATE UNIQUE INDEX UX_Users_GoogleId ON dbo.Users (GoogleId) WHERE GoogleId IS NOT NULL;
GO
