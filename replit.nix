{pkgs}: {
  deps = [
    pkgs.alsa-lib
    pkgs.mesa
    pkgs.libdrm
    pkgs.cups
    pkgs.nss
    pkgs.xorg.libXtst
    pkgs.xorg.libXrandr
    pkgs.xorg.libXi
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcursor
    pkgs.xorg.libXcomposite
    pkgs.xorg.libxcb
    pkgs.xorg.libX11
    pkgs.chromium
  ];
}
